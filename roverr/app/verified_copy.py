"""Verified staged transfers shared with the standalone Windows receptor."""
import hashlib
import json
import os

BLOCK_SIZE = 1024 * 1024


def source_identity(path):
    if os.path.islink(path) or not os.path.isfile(path):
        raise ValueError('El origen debe ser un archivo normal')
    stat = os.stat(path)
    return {'path': os.path.normcase(os.path.realpath(path)), 'size': stat.st_size,
            'mtime_ns': stat.st_mtime_ns, 'ctime_ns': stat.st_ctime_ns}


def remove_resume_metadata(temporary):
    for path in (temporary + '.json', temporary + '.json.tmp'):
        if os.path.lexists(path):
            if os.path.islink(path):
                raise ValueError('Los metadatos temporales no pueden ser un enlace')
            os.remove(path)


def prepare_resume(source, temporary, final, task_id, check_cancelled):
    """Reuse only an owned temporary whose entire prefix matches the source."""
    check_cancelled()
    expected = {'version': 1, 'source': source_identity(source),
                'destination': os.path.normcase(os.path.realpath(final)), 'task_id': task_id}
    metadata = temporary + '.json'
    for path in (temporary, metadata, metadata + '.tmp'):
        if os.path.islink(path):
            raise ValueError('El archivo temporal no puede ser un enlace')
    offset = 0
    if os.path.exists(temporary):
        valid = False
        try:
            with open(metadata, encoding='utf-8') as stream:
                valid = json.load(stream) == expected
            offset = os.path.getsize(temporary)
            valid = valid and offset <= expected['source']['size']
            if valid:
                with open(source, 'rb') as original, open(temporary, 'rb') as partial:
                    remaining = offset
                    while remaining:
                        check_cancelled()
                        length = min(BLOCK_SIZE, remaining)
                        if original.read(length) != partial.read(length):
                            valid = False
                            break
                        remaining -= length
                valid = valid and source_identity(source) == expected['source']
        except InterruptedError:
            raise
        except (OSError, ValueError, TypeError):
            valid = False
        if not valid:
            check_cancelled()
            os.remove(temporary)
            offset = 0
    check_cancelled()
    with open(metadata + '.tmp', 'w', encoding='utf-8') as stream:
        json.dump(expected, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(metadata + '.tmp', metadata)
    return offset, expected['source']


def verify_copy(source, temporary, identity, check_cancelled):
    """Read both complete files and compare SHA-256 before publication."""
    check_cancelled()
    if source_identity(source) != identity or os.path.getsize(temporary) != identity['size']:
        raise ValueError('El origen cambió o la copia está incompleta; no se publicará el archivo')
    output_before = os.stat(temporary)
    hashes = [hashlib.sha256(), hashlib.sha256()]
    with open(source, 'rb') as original, open(temporary, 'rb') as output:
        while True:
            check_cancelled()
            first, second = original.read(BLOCK_SIZE), output.read(BLOCK_SIZE)
            hashes[0].update(first)
            hashes[1].update(second)
            if not first and not second:
                break
    output_after = os.stat(temporary)
    if (hashes[0].digest() != hashes[1].digest() or source_identity(source) != identity
            or (output_before.st_size, output_before.st_mtime_ns) != (output_after.st_size, output_after.st_mtime_ns)):
        raise ValueError('La verificación SHA-256 falló; se conserva el destino original')
    check_cancelled()
    return hashes[0].hexdigest()

