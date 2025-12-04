/**
 * Modal Loader
 * Dynamically loads modal HTML files and injects them into the DOM
 */

const MODAL_FILES = [
    'delete-modal.html',
    'edit-indexer-modal.html',
    'edit-rss-modal.html',
    'manual-search-modal.html',
    'ignored-movies-modal.html'
];

/**
 * Load all modal HTML files and inject them into the DOM
 * @returns {Promise<void>}
 */
export async function loadModals() {
    try {
        const modalPromises = MODAL_FILES.map(async (filename) => {
            const response = await fetch(`modals/${filename}`);
            if (!response.ok) {
                throw new Error(`Failed to load ${filename}: ${response.statusText}`);
            }
            return response.text();
        });

        const modalHTMLs = await Promise.all(modalPromises);

        // Create a temporary container to parse HTML
        const temp = document.createElement('div');
        temp.innerHTML = modalHTMLs.join('\n');

        // Append each modal directly to body (not wrapped in a container)
        while (temp.firstChild) {
            document.body.appendChild(temp.firstChild);
        }

        console.log(`✅ Loaded ${MODAL_FILES.length} modals successfully`);
    } catch (error) {
        console.error('❌ Error loading modals:', error);
        throw error;
    }
}
