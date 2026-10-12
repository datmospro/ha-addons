export function translateMessage(message) {
    const text = String(message || '');
    return text
        .replace(/No torrent within size limits \(max: ([\d.]+) MB\)/g, 'No se encontró ningún torrent dentro del tamaño máximo de $1 MB')
        .replace(/No torrents found/g, 'No se encontraron torrents')
        .replace(/Auto-download disabled for this feed/g, 'La descarga automática está desactivada para esta fuente RSS')
        .replace(/Download client error:/g, 'Error del cliente de descargas:')
        .replace(/Torrent client did not respond/g, 'El cliente de torrents no respondió')
        .replace(/Destination file already exists:/g, 'El archivo de destino ya existe:')
        .replace(/Source (?:file |path )?(?:not found|does not exist):/g, 'No se encuentra el origen:')
        .replace(/Permission denied/g, 'Permiso denegado')
        .replace(/File not found in /g, 'Archivo no encontrado en ')
        .replace(/Invalid name format/g, 'El nombre del archivo no tiene un formato válido')
        .replace(/Receptor offline/g, 'Receptor desconectado');
}
