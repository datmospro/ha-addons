"""On-demand support diagnostics with an allowlisted, redacted export."""
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, quote, quote_plus, unquote
import copy
import json
import ntpath
import re
import threading
import requests
import qbittorrentapi
from peewee import fn
from database import Movie, CopyJob, CopyQueueControl
from filesystem_diagnostics import diagnostic_check, filesystem_diagnostics
from .config import load_settings

RUN_LOCK = threading.Lock()
REPORT_LOCK = threading.Lock()
LATEST_REPORT = None


def addon_version():
    for path in (Path(__file__).resolve().parents[1] / 'addon_config.yaml', Path(__file__).resolve().parents[2] / 'config.yaml'):
        try:
            match = re.search(r'^version:\s*["\']?([\d.]+)', path.read_text(encoding='utf-8'), re.M)
            if match:
                return match.group(1)
        except OSError:
            pass
    return 'desconocida'


def redact_report(report, settings):
    secrets = set()
    def collect(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if any(word in str(key).lower() for word in ('pass', 'token', 'api_key', 'apikey', 'secret', 'cookie', 'authorization')) and isinstance(item, str) and item:
                    secrets.add(item)
                elif isinstance(item, (dict, list)):
                    collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
    collect(settings)
    for key in ('qb_host', 'receptor_host'):
        try:
            parsed = urlsplit(str(settings.get(key) or '') if '://' in str(settings.get(key) or '') else 'http://' + str(settings.get(key) or ''))
            for value in (parsed.username, parsed.password):
                if value:
                    secrets.add(value)
                    secrets.add(unquote(value))
        except ValueError:
            pass
    variants = sorted({variant for value in secrets for variant in (value, quote(value, safe=''), quote_plus(value))}, key=len, reverse=True)
    def clean(value):
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items()}
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, str):
            value = re.sub(r'(?i)([a-z][a-z0-9+.-]*://)[^/\s]*@', r'\1[oculto]@', value)
            value = re.sub(r'(?i)([?&](?:api[_-]?key|token|access_token|password|pass|secret|authorization|auth)=)[^&#\s]*', r'\1[oculto]', value)
            for secret in variants:
                value = value.replace(secret, '[oculto]')
        return value
    return clean(report)


def public_endpoint(host, port):
    try:
        parsed = urlsplit(str(host) if '://' in str(host) else 'http://' + str(host))
        if parsed.hostname:
            return {'host': parsed.hostname[:255], 'port': int(port)}
    except (ValueError, TypeError):
        pass
    return {}


def connection_failure(error, service):
    name = type(error).__name__.lower()
    if 'loginfailed' in name or getattr(getattr(error, 'response', None), 'status_code', None) in (401,403):
        return 'La autenticación fue rechazada.', 'Revisa las credenciales guardadas y los permisos de acceso.'
    if 'timeout' in name:
        return 'Se agotó el tiempo de espera.', 'Comprueba la dirección, el puerto, la red y el cortafuegos.'
    return f'No se pudo conectar con {service}.', 'Comprueba que el servicio esté iniciado y que la dirección y el puerto sean correctos.'


def mapped_windows_path(path, mapping):
    result = str(path or '')
    for line in str(mapping or '').splitlines():
        if '=' not in line:
            continue
        linux, windows = (part.strip() for part in line.split('=', 1))
        if linux and result.rstrip('/') == linux.rstrip('/'):
            result = windows.rstrip('/\\').replace('/', '\\')
            break
        if linux and result.startswith(linux.rstrip('/') + '/'):
            result = (windows + result[len(linux):]).replace('/', '\\')
            break
    if not ntpath.isabs(result) or not ntpath.splitdrive(result)[0]:
        raise ValueError('Missing Windows mapping')
    return result


def queue_diagnostic():
    try:
        check = CopyJob._meta.database.execute_sql('PRAGMA quick_check').fetchone()
        if not check or check[0] != 'ok':
            raise ValueError('Database integrity check failed')
        counts = {state: CopyJob.select().where(CopyJob.state == state).count() for state in ('queued','running','completed','cancelled','error')}
        control = CopyQueueControl.get_or_none(CopyQueueControl.id == 1)
        paused = bool(control and control.paused)
        pending = CopyJob.select(CopyJob.torrent_hash).where(CopyJob.state.in_(('queued','running')))
        largest = Movie.select(fn.MAX(Movie.size)).where(Movie.torrent_hash.in_(pending)).scalar() or 0
        details = {'paused': paused, 'jobs': counts}
        message = 'La base de datos responde y la cola está pausada.' if paused else 'La base de datos responde y la cola está activa.'
        action = 'Pulsa Reanudar cola en el panel de actividad para continuar.' if paused else 'Revisa Últimos resultados si alguna película requiere intervención.' if counts['error'] else ''
        return diagnostic_check('queue', 'Base de datos y cola', 'warning' if paused or counts['error'] else 'ok', message, action, details), largest
    except Exception:
        return diagnostic_check('queue', 'Base de datos y cola', 'error', 'No se pudo comprobar la base de datos o la cola.', 'Revisa el almacenamiento de datos del addon y su registro.'), 0


def automatic_copy_diagnostic(settings):
    feeds = settings.get('rss_feeds')
    enabled = [feed for feed in feeds if isinstance(feed,dict) and feed.get('enabled',True)] if isinstance(feeds,list) else []
    copy_feeds = sum(bool(feed.get('auto_copy')) for feed in enabled)
    manual = bool(settings.get('auto_copy_manual_search'))
    details = {'enabled_rss_feeds': len(enabled), 'rss_auto_copy_feeds': copy_feeds,
               'rss_auto_download_feeds': sum(bool(feed.get('auto_add')) for feed in enabled),
               'manual_search_auto_copy': manual}
    if not copy_feeds and not manual:
        return diagnostic_check('automatic_copy','Copia automática','warning','La copia automática no está activada para RSS ni para búsquedas manuales.',
            'Actívala en la fuente RSS o en las opciones de búsquedas manuales y guarda los cambios si quieres copiar sin pulsar Copiar.',details)
    return diagnostic_check('automatic_copy','Copia automática','ok','Hay entradas configuradas para copiar automáticamente cuando termine la descarga.',details=details)


def build_diagnostics(settings):
    checks = []
    try:
        port = int(settings.get('qb_port', 8080))
        if not 1 <= port <= 65535:
            raise ValueError('Invalid port')
        qb = qbittorrentapi.Client(host=settings.get('qb_host', 'localhost'), port=port,
             username=settings.get('qb_user', ''), password=settings.get('qb_pass', ''), REQUESTS_ARGS={'timeout': (3,5)})
        qb.auth_log_in()
        version = str(qb.app_version())[:40]
        checks.append(diagnostic_check('qbittorrent', 'Conexión con qBittorrent', 'ok', 'La conexión y la autenticación funcionan.', details=dict(public_endpoint(settings.get('qb_host','localhost'),port), version=version)))
    except Exception as error:
        message, action = connection_failure(error, 'qBittorrent')
        checks.append(diagnostic_check('qbittorrent', 'Conexión con qBittorrent', 'error', message, action, public_endpoint(settings.get('qb_host','localhost'),settings.get('qb_port',8080))))
    queue, largest = queue_diagnostic()
    checks.append(queue)
    checks.append(automatic_copy_diagnostic(settings))
    source, destination = settings.get('local_source_path', ''), settings.get('local_dest_path', '')
    if not settings.get('receptor_enabled'):
        checks.append(diagnostic_check('receptor', 'Receptor de Windows', 'skipped', 'La copia remota está desactivada; las rutas se comprueban en Home Assistant.'))
        checks.extend(filesystem_diagnostics(source, destination, largest))
    else:
        receiver_stage = 'connection'
        try:
            host = str(settings.get('receptor_host') or '')
            port = int(settings.get('receptor_port', 8095))
            if not host or not 1 <= port <= 65535 or any(char in host for char in '/@?#'):
                raise ValueError('Invalid receptor endpoint')
            base = f'http://{host}:{port}'
            response = requests.get(base + '/ping', timeout=5)
            response.raise_for_status()
            health = response.json()
            if health.get('service') != 'Roverr Receptor' or health.get('status') != 'ok':
                raise ValueError('Wrong service')
            supported = health.get('diagnostics') is True
            checks.append(diagnostic_check('receptor', 'Conexión con el receptor', 'ok' if supported else 'warning',
                'El receptor responde y admite las comprobaciones.' if supported else 'El receptor responde, pero no admite el diagnóstico de rutas.',
                '' if supported else 'Actualiza y reinicia el receptor a 4.5.14.', dict(public_endpoint(host,port), version=str(health.get('version') or 'desconocida')[:40])))
            try:
                mapped_source = mapped_windows_path(source, settings.get('receptor_path_mapping'))
                mapped_destination = mapped_windows_path(destination, settings.get('receptor_path_mapping'))
                checks.append(diagnostic_check('path_mapping', 'Correspondencias de rutas', 'ok', 'Las rutas tienen un destino de Windows válido.',
                    details={'source': mapped_source, 'destination': mapped_destination}))
            except ValueError:
                checks.append(diagnostic_check('path_mapping', 'Correspondencias de rutas', 'error', 'El origen o el destino no se traduce a una ruta absoluta de Windows.',
                    'Revisa las correspondencias Linux=Windows y guarda los cambios.'))
                mapped_source = mapped_destination = None
            if supported and mapped_source and mapped_destination:
                receiver_stage = 'filesystem'
                response = requests.post(base + '/diagnostics', json={'source': mapped_source, 'destination': mapped_destination, 'largest_pending_bytes': largest}, timeout=10)
                response.raise_for_status()
                data = response.json()
                rows = data.get('checks')
                expected = {'source_path', 'destination_path', 'disk_space'}
                if not isinstance(rows, list) or {row.get('id') for row in rows if isinstance(row,dict)} != expected or len(rows) != 3:
                    raise ValueError('Invalid remote diagnostic result')
                for row in rows:
                    if row.get('status') not in ('ok','warning','error','skipped'):
                        raise ValueError('Invalid status')
                    details = row.get('details') if isinstance(row.get('details'), dict) else {}
                    # Never include arbitrary remote fields, logs or nested configuration.
                    safe_details = {key: value for key,value in details.items() if key in ('path','sample_read','temporary_file','total_bytes','free_bytes','largest_pending_bytes') and isinstance(value,(str,int,float,bool))}
                    checks.append(diagnostic_check(row['id'], str(row.get('title',''))[:200], row['status'], str(row.get('message',''))[:1500], str(row.get('action',''))[:1500], safe_details))
            else:
                for key,title in (('source_path','Origen en Windows'),('destination_path','Destino en Windows'),('disk_space','Espacio en Windows')):
                    checks.append(diagnostic_check(key,title,'skipped','Esta comprobación necesita un receptor compatible y correspondencias de rutas válidas.'))
        except Exception as error:
            message, action = connection_failure(error, 'el receptor')
            if receiver_stage == 'filesystem':
                message = 'El receptor responde, pero no se pudo obtener un diagnóstico válido de las rutas.'
                action = 'Reinicia el receptor actualizado y vuelve a ejecutar las comprobaciones.'
            elif isinstance(error, ValueError):
                message = 'La dirección, el puerto o la respuesta del receptor no son válidos.'
                action = 'Comprueba la IP y el puerto del receptor y guarda los cambios.'
            checks.append(diagnostic_check('receiver_diagnostics', 'Comprobación remota', 'error', message, action, public_endpoint(settings.get('receptor_host',''),settings.get('receptor_port',8095))))
            existing = {check['id'] for check in checks}
            for key,title in (('source_path','Origen en Windows'),('destination_path','Destino en Windows'),('disk_space','Espacio en Windows')):
                if key not in existing:
                    checks.append(diagnostic_check(key,title,'skipped','No se ha podido completar esta comprobación desde el receptor.'))
    report = {'generated_at': datetime.now(timezone.utc).isoformat(), 'addon_version': addon_version(),
              'mode': 'receptor' if settings.get('receptor_enabled') else 'local', 'checks': checks}
    report['summary'] = {status: sum(row['status'] == status for row in checks) for status in ('ok','warning','error','skipped')}
    return redact_report(report, settings)


def run_diagnostics():
    global LATEST_REPORT
    if not RUN_LOCK.acquire(blocking=False):
        return {'success': False, 'message': 'Hay un diagnóstico en curso. Espera a que termine.'}
    try:
        report = build_diagnostics(load_settings())
        with REPORT_LOCK:
            LATEST_REPORT = copy.deepcopy(report)
        return {'success': True, 'report': report}
    except Exception:
        return {'success': False, 'message': 'No se pudo completar el diagnóstico. Revisa el registro del addon.'}
    finally:
        RUN_LOCK.release()
        Movie._meta.database.close()


def latest_diagnostics():
    with REPORT_LOCK:
        return copy.deepcopy(LATEST_REPORT)
