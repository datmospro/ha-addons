"""Small filesystem probes; shared with the standalone Windows receptor."""
import errno
import os
import shutil
import tempfile


def diagnostic_check(check_id, title, status, message, action='', details=None):
    return {'id': check_id, 'title': title, 'status': status, 'message': message,
            'action': action, 'details': details or {}}


def directory_diagnostic(path, destination=False):
    check_id = 'destination_path' if destination else 'source_path'
    title = 'Destino y permisos de escritura' if destination else 'Origen y permisos de lectura'
    details = {'path': path}
    if not isinstance(path, str) or not path.strip():
        return diagnostic_check(check_id, title, 'error', 'La ruta no está configurada.', 'Configura la ruta y guarda los cambios.')
    if not os.path.isdir(path):
        return diagnostic_check(check_id, title, 'error', 'La carpeta no existe o no está disponible en este equipo.',
                                'Comprueba la ruta, el montaje de la unidad y los permisos de la cuenta que ejecuta la copia.', details)
    temporary = None
    failure = None
    try:
        with os.scandir(path) as entries:
            sample = None
            for index, entry in enumerate(entries):
                if index >= 100:
                    break
                if entry.is_file(follow_symlinks=False) and (destination or os.path.splitext(entry.name)[1].lower() in ('.mkv','.mp4','.avi')):
                    sample = entry.path
                    break
        if not destination:
            if sample:
                with open(sample, 'rb') as stream:
                    stream.read(1)
            details['sample_read'] = bool(sample)
            message = 'La carpeta es accesible y se ha podido leer un archivo.' if sample else 'La carpeta es accesible; no se ha probado la lectura de un vídeo en su raíz.'
            return diagnostic_check(check_id, title, 'ok', message, details=details)
        fd, temporary = tempfile.mkstemp(prefix='.roverr-diagnostico-', dir=path)
        with os.fdopen(fd, 'w+b') as stream:
            stream.write(b'Roverr')
            stream.flush()
            os.fsync(stream.fileno())
            stream.seek(0)
            if stream.read() != b'Roverr':
                raise OSError('Probe verification failed')
    except PermissionError:
        failure = diagnostic_check(check_id, title, 'error', 'No hay permisos suficientes para acceder a la carpeta o escribir en ella.',
                                   'Concede permisos a la cuenta que ejecuta la copia y vuelve a comprobarlo.', details)
    except OSError as error:
        full = error.errno == errno.ENOSPC
        failure = diagnostic_check(check_id, title, 'error', 'El disco no tiene espacio libre.' if full else 'No se pudo completar la prueba de acceso a la carpeta.',
                                   'Libera espacio en el destino.' if full else 'Comprueba que la unidad siga conectada y que la carpeta sea accesible.', details)
    finally:
        if temporary:
            try:
                os.remove(temporary)
            except OSError:
                details['temporary_file'] = temporary
                failure = diagnostic_check(check_id, title, 'error', 'La prueba no pudo eliminar su archivo temporal.',
                                           'Revisa los permisos de eliminación y elimina únicamente el archivo temporal indicado.', details)
    return failure or diagnostic_check(check_id, title, 'ok', 'Se ha comprobado la escritura, lectura y eliminación de un archivo temporal propio.', details=details)


def disk_space_diagnostic(destination, largest_pending_bytes=0):
    try:
        if not isinstance(destination, str) or not destination or not os.path.isdir(destination):
            raise OSError('Unavailable destination')
        usage = shutil.disk_usage(destination)
        details = {'path': destination, 'total_bytes': usage.total, 'free_bytes': usage.free,
                   'largest_pending_bytes': max(0, int(largest_pending_bytes))}
        if usage.free <= 0:
            return diagnostic_check('disk_space', 'Espacio en el destino', 'error', 'No queda espacio libre.', 'Libera espacio antes de iniciar nuevas copias.', details)
        if usage.free < 500 * 1024 * 1024 or usage.free < details['largest_pending_bytes']:
            return diagnostic_check('disk_space', 'Espacio en el destino', 'warning', 'El espacio libre puede ser insuficiente para las próximas copias.',
                                    'Libera espacio o revisa el tamaño de las películas pendientes. Los parciales y las sobrescrituras pueden cambiar el espacio necesario.', details)
        return diagnostic_check('disk_space', 'Espacio en el destino', 'ok', 'El disco tiene espacio libre en el momento de esta comprobación.', details=details)
    except (OSError, ValueError, TypeError):
        return diagnostic_check('disk_space', 'Espacio en el destino', 'error', 'No se pudo consultar el espacio del destino.', 'Comprueba que la unidad y la ruta estén disponibles.')


def filesystem_diagnostics(source, destination, largest_pending_bytes=0):
    return [directory_diagnostic(source), directory_diagnostic(destination, destination=True),
            disk_space_diagnostic(destination, largest_pending_bytes)]
