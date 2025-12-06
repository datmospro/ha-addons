#!/usr/bin/env python3
# Fix text wrapping in movie details for all screen sizes
import os
import re

css_file = r"c:\Users\Datmos\Documents\ha-addons\roverr\app\static\styles\movies.css"

# Read the file
with open(css_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Remove overflow: hidden from movie-details-layout
content = re.sub(
    r'(\.movie-details-layout \{[^}]*?)overflow:\s*hidden;([^}]*?\})',
    r'\1\2',
    content,
    flags=re.DOTALL
)

# Fix 2: Add movie-info-panel styles before .movie-info-panel h1
# Find the section before .movie-info-panel h1
insert_point = content.find('.movie-info-panel h1 {')
if insert_point != -1:
    # Add the new styles
    new_styles = """.movie-info-panel {
    min-width: 0;
    width: 100%;
    overflow-wrap: break-word;
    word-wrap: break-word;
}

"""
    content = content[:insert_point] + new_styles + content[insert_point:]

# Fix 3: Change overflow: hidden to word-wrap in .movie-info-panel h1
content = re.sub(
    r'(\.movie-info-panel h1 \{[^}]*?)overflow:\s*hidden;',
    r'\1word-wrap: break-word;\n    overflow-wrap: break-word;',
    content,
    flags=re.DOTALL
)

# Write back
with open(css_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Movie details layout fixed!")
print("   - Removed overflow:hidden from .movie-details-layout")
print("   - Added .movie-info-panel wrapper styles")
print("   - Changed h1 from overflow:hidden to word-wrap")
