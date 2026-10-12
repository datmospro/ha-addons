"""Filesystem-only copy inspection, also embedded in the standalone receptor."""
import hashlib
import json
import os
from datetime import datetime, timezone


def file_info(path):
    try:
        stat = os.stat(path)
    except FileNotFoundError:
        return {'path': path, 'exists': False, 'size': None,
                'modified': None, 'mtime_ns': None}
    if not os.path.isfile(path):
        raise ValueError(f'Expected a file: {path}')
    return {'path': path, 'exists': True, 'size': stat.st_size,
            'modified': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            'mtime_ns': stat.st_mtime_ns}


def inspect_files(source, destination, folder_name):
    if not os.path.exists(source):
        raise FileNotFoundError(f'Source not found: {source}')
    if not folder_name or os.path.basename(folder_name) != folder_name or folder_name in ('.', '..'):
        raise ValueError('Invalid destination folder name')
    if os.path.isfile(source):
        sources = [source]
    elif os.path.isdir(source):
        sources = sorted(os.path.join(root, name)
                         for root, _, files in os.walk(source) for name in files
                         if os.path.splitext(name)[1].lower() in ('.mkv', '.mp4', '.avi'))
    else:
        raise ValueError('Invalid source path')
    if not sources:
        raise ValueError('No video files found in source')
    entries = []
    seen = set()
    for path in sources:
        target = os.path.join(destination, folder_name + os.path.splitext(path)[1])
        target_real = os.path.realpath(target)
        dest_real = os.path.realpath(destination)
        if os.path.commonpath([target_real, dest_real]) != dest_real:
            raise ValueError('Destination file escapes destination directory')
        if os.path.normcase(target_real) == os.path.normcase(os.path.realpath(path)):
            raise ValueError('Source and destination refer to the same file')
        if os.path.normcase(target_real) in seen:
            raise ValueError('Multiple source files would use the same destination filename')
        seen.add(os.path.normcase(target_real))
        src, dst = file_info(path), file_info(target)
        difference = dst['size'] - src['size'] if dst['exists'] else None
        entries.append({'source': src, 'destination': dst,
                        'difference_bytes': difference,
                        'same_size': dst['exists'] and difference == 0})
    fingerprint = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    return {'source_path': source, 'destination_path': destination,
            'folder_name': folder_name, 'files': entries,
            'conflict': any(row['destination']['exists'] for row in entries),
            'all_destinations_exist': all(row['destination']['exists'] for row in entries),
            'fingerprint': fingerprint}
