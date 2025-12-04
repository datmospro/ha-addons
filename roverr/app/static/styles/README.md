# CSS Modular Architecture

## Structure

```
app/static/styles/
├── base.css          - Variables, reset, global styles, animations
├── layout.css        - App layout, sidebar, main content, views
├── components.css    - Buttons, cards, tables, forms
├── movies.css        - Movie grid, details, headers, ratings
└── status.css        - Status badges (dashboard, overlay, detail)
```

## Usage

The CSS modules are loaded in `index.html` in this specific order:

```html
<link rel="stylesheet" href="styles/base.css">       <!-- Variables & reset -->
<link rel="stylesheet" href="styles/layout.css">     <!-- Structure -->
<link rel="stylesheet" href="styles/components.css"> <!-- UI elements -->
<link rel="stylesheet" href="styles/movies.css">     <!-- Features -->
<link rel="stylesheet" href="styles/status.css">     <!-- Badges -->
```

## Module Descriptions

### base.css
- CSS custom properties (variables)
- Global reset (`*`, `body`)
- Animations (`@keyframes fadeIn`)

### layout.css
- `.app-layout` - Main app grid
- `.sidebar` - Sidebar navigation
- `.main-content` - Scrollable content area
- `.view` - View management (display: none/block)

### components.css
- `.btn` - Button styles
- `.content-card` - Card containers
- `table` - Table styles
- `input` - Form inputs
- `.settings-list` - Settings UI

### movies.css
- `.movies-grid` - Movie grid layout
- `.movie-card` - Movie cards
- `.movie-details-layout` - Detail view
- `.movie-sticky-header` - Fixed headers
- `.cast-carousel` - Cast/crew sections

### status.css
- `.status-badge` - Dashboard status badges
- `.overlay-status` - Movie card overlays
- `.badge.status` - Detail view badges

## Benefits

1. **Easier Editing** - Smaller files, easier to navigate
2. **Faster Updates** - Edit only the relevant module
3. **Better Organization** - Clear separation of concerns
4. **Reduced Errors** - Less chance of breaking unrelated styles
5. **Team Collaboration** - Multiple people can edit different modules

## Making Changes

### Example: Change Button Color
Edit only `styles/components.css`:
```css
.btn.primary {
    background-color: #your-color;
}
```

### Example: Add New Status
Edit only `styles/status.css`:
```css
.badge.status.your-status {
    background-color: rgba(...);
    color: ...;
}
```

### Example: Adjust Layout
Edit only `styles/layout.css`:
```css
.main-content {
    /* your changes */
}
```

## Old style.css

The original `style.css` is still present for reference but is no longer used.
You can delete it once you've confirmed everything works correctly.
