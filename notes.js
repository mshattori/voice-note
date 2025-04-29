/**
 * Notes Module - Handles CRUD operations for notes
 * This module manages note creation, reading, updating, and deletion
 * using localStorage as the storage mechanism.
 */

/**
 * Initialize the notes module
 * Sets up event listeners and loads the note list
 */
export function initNotesModule() {
    // Get DOM elements
    const saveIcon = document.getElementById('save-icon');
    const saveNoteBtn = document.getElementById('save-note-btn');
    const saveModal = document.getElementById('save-modal');
    const noteTitleInput = document.getElementById('note-title');
    const mainTabs = document.getElementById('main-tabs');
    
    // Current editing note ID (when in edit mode)
    let currentEditingNoteId = null;
    
    // Set up event listeners
    saveIcon.addEventListener('click', () => {
        const transcriptionResult = document.getElementById('transcription-result');
        const content = transcriptionResult.value.trim();
        
        if (!content) {
            UIkit.notification('There is no content to save', { status: 'warning' });
            return;
        }
        
        if (currentEditingNoteId) {
            // In edit mode, display the current note title
            const notes = getNoteList();
            const note = notes.find(note => note.id === currentEditingNoteId);
            if (note) {
                noteTitleInput.value = note.title;
            } else {
                noteTitleInput.value = '';
            }
        } else {
            // In create mode, reset the title input
            noteTitleInput.value = '';
        }
        
        UIkit.modal(saveModal).show();
    });
    
    saveNoteBtn.addEventListener('click', () => {
        const title = noteTitleInput.value.trim();
        const content = document.getElementById('transcription-result').value.trim();
        
        if (!title) {
            UIkit.notification('Please enter a title for your note', { status: 'warning' });
            return;
        }
        
        if (!content) {
            UIkit.notification('There is no content to save', { status: 'warning' });
            return;
        }
        
        if (currentEditingNoteId) {
            // Update existing note
            updateNote(currentEditingNoteId, title, content);
            
            // Reset edit mode
            currentEditingNoteId = null;
            
            // Success notification
            UIkit.notification('Note updated successfully', { status: 'success' });
        } else {
            // Create new note
            createNote(title, content);
            
            // Success notification
            UIkit.notification('Note saved successfully', { status: 'success' });
        }
        
        // Close the modal
        UIkit.modal(saveModal).hide();
        
        // Clear the text area
        document.getElementById('transcription-result').value = '';
        
        // Trigger input event to resize the textarea and update control state
        const inputEvent = new Event('input', {
            bubbles: true,
            cancelable: true,
        });
        document.getElementById('transcription-result').dispatchEvent(inputEvent);
        
        // Clear from localStorage
        localStorage.removeItem('voice-note-transcription');
    });
    
    // Load the note list when the notes tab is shown
    UIkit.util.on('#main-tabs', 'shown', function(e) {
        if (e.target.textContent.trim() === 'Notes List') {
            loadNoteList();
        }
    });
    
    // Initial load of note list
    loadNoteList();
    
    // Set up event delegation for note cards
    document.getElementById('notes-list').addEventListener('click', function(e) {
        // Handle delete icon click
        if (e.target.closest('.note-delete-icon')) {
            e.stopPropagation(); // Prevent card click event
            const noteCard = e.target.closest('.uk-card').parentNode;
            const noteId = noteCard.dataset.noteId;
            
            // Confirm deletion
            UIkit.modal.confirm('Are you sure you want to delete this note?').then(function() {
                deleteNote(noteId);
            }, function() {
                // User canceled deletion
            });
        } 
        // Handle card click (open editor)
        else if (e.target.closest('.uk-card')) {
            const noteCard = e.target.closest('.uk-card').parentNode;
            const noteId = noteCard.dataset.noteId;
            openNoteEditor(noteId);
        }
    });
    // Listen for note edit events
    document.addEventListener('edit-note', (e) => {
        currentEditingNoteId = e.detail.noteId;
    });
}

/**
 * Load the note list from localStorage and build the DOM
 */
export function loadNoteList() {
    const notesList = document.getElementById('notes-list');
    
    // Clear the current list
    notesList.innerHTML = '';
    
    // Get the note list from localStorage
    const notes = getNoteList();
    
    if (notes.length === 0) {
        // Display a message if there are no notes
        notesList.innerHTML = `
            <div class="uk-width-1-1">
                <div class="uk-card uk-card-default uk-card-body uk-text-center uk-padding uk-box-shadow-small" style="border-radius: 0.5rem;">
                    <span uk-icon="icon: file-text; ratio: 2" class="uk-margin-small-bottom uk-text-muted"></span>
                    <p class="uk-text-medium">No notes saved yet. Create your first note by recording or typing content and clicking the save icon.</p>
                </div>
            </div>
        `;
        return;
    }
    
    // Sort notes by updatedAt (newest first)
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    
    // Create a card for each note
    notes.forEach(note => {
        // Get the note content preview
        const noteContent = localStorage.getItem(note.filePath) || '';
        const previewText = noteContent.substring(0, 150) + (noteContent.length > 150 ? '...' : '');
        
        // Format the date as year/month/date hour:minutes
        const createdDate = new Date(note.createdAt);
        const year = createdDate.getFullYear();
        const month = String(createdDate.getMonth() + 1).padStart(2, '0');
        const date = String(createdDate.getDate()).padStart(2, '0');
        const hours = String(createdDate.getHours()).padStart(2, '0');
        const minutes = String(createdDate.getMinutes()).padStart(2, '0');
        const formattedDate = `${year}/${month}/${date} ${hours}:${minutes}`;
        
        // Create the note card
        const noteCard = document.createElement('div');
        noteCard.dataset.noteId = note.id;
        noteCard.innerHTML = `
            <div class="uk-card uk-card-default uk-card-hover uk-box-shadow-small">
                <div class="uk-card-header">
                    <h3 class="uk-card-title uk-margin-remove-bottom uk-text-left">${escapeHtml(note.title)}</h3>
                </div>
                <div class="uk-card-body uk-padding-small">
                    <p class="note-preview uk-text-left">${escapeHtml(previewText)}</p>
                </div>
                <div class="uk-card-footer uk-padding-small uk-flex uk-flex-between uk-flex-middle">
                    <small class="uk-text-muted">${formattedDate}</small>
                    <span uk-icon="icon: trash" class="note-delete-icon" uk-tooltip="Delete" style="color: inherit;"></span>
                </div>
            </div>
        `;
        
        notesList.appendChild(noteCard);
    });
}

/**
 * Create a new note
 * @param {string} title - The note title
 * @param {string} content - The note content
 * @returns {string} The ID of the created note
 */
export function createNote(title, content) {
    // Generate a new note ID based on current timestamp
    const now = new Date();
    const id = generateNoteId(now);
    
    // Create the note metadata
    const note = {
        id: id,
        filePath: `note_${id}.txt`,
        title: title,
        createdAt: now.getTime(),
        updatedAt: now.getTime()
    };
    
    // Get the current note list
    const notes = getNoteList();
    
    // Add the new note to the list
    notes.push(note);
    
    // Save the updated note list
    localStorage.setItem('noteList', JSON.stringify(notes));
    
    // Save the note content
    localStorage.setItem(note.filePath, content);
    
    // Refresh the note list display
    loadNoteList();
    
    document.dispatchEvent(new CustomEvent('note-created', {
        detail: { noteId: id }
    }));
    
    return id;
}

/**
 * Update an existing note
 * @param {string} id - The note ID
 * @param {string} title - The updated title
 * @param {string} content - The updated content
 * @returns {boolean} True if the update was successful
 */
export function updateNote(id, title, content) {
    // Get the current note list
    const notes = getNoteList();
    
    // Find the note to update
    const noteIndex = notes.findIndex(note => note.id === id);
    
    if (noteIndex === -1) {
        console.error(`Note with ID ${id} not found`);
        UIkit.notification('Error: Note not found', { status: 'danger' });
        return false;
    }
    
    // Update the note metadata
    notes[noteIndex].title = title;
    notes[noteIndex].updatedAt = new Date().getTime();
    
    // Save the updated note list
    localStorage.setItem('noteList', JSON.stringify(notes));
    
    // Save the updated note content
    localStorage.setItem(notes[noteIndex].filePath, content);
    
    // Refresh the note list display
    loadNoteList();
    
    document.dispatchEvent(new CustomEvent('note-updated', {
        detail: { noteId: id }
    }));
    
    return true;
}

/**
 * Delete a note
 * @param {string} id - The note ID
 * @returns {boolean} True if the deletion was successful
 */
export function deleteNote(id) {
    // Get the current note list
    const notes = getNoteList();
    
    // Find the note to delete
    const noteIndex = notes.findIndex(note => note.id === id);
    
    if (noteIndex === -1) {
        console.error(`Note with ID ${id} not found`);
        UIkit.notification('Error: Note not found', { status: 'danger' });
        return false;
    }
    
    // Get the file path before removing from array
    const filePath = notes[noteIndex].filePath;
    
    // Remove the note from the list
    notes.splice(noteIndex, 1);
    
    // Save the updated note list
    localStorage.setItem('noteList', JSON.stringify(notes));
    
    // Remove the note content
    localStorage.removeItem(filePath);
    
    // Refresh the note list display
    loadNoteList();
    
    document.dispatchEvent(new CustomEvent('note-deleted', {
        detail: { noteId: id }
    }));
    
    // Show success notification
    UIkit.notification('Note deleted successfully', { status: 'success' });
    
    return true;
}

/**
 * Open the note editor for a specific note
 * @param {string} id - The note ID
 */
export function openNoteEditor(id) {
    // Get the current note list
    const notes = getNoteList();
    
    // Find the note to edit
    const note = notes.find(note => note.id === id);
    
    if (!note) {
        console.error(`Note with ID ${id} not found`);
        UIkit.notification('Error: Note not found', { status: 'danger' });
        return;
    }
    
    // Get the note content
    const content = localStorage.getItem(note.filePath) || '';
    
    // Set the content in the text area
    const transcriptionResult = document.getElementById('transcription-result');
    transcriptionResult.value = content;
    
    // Update currentEditingNoteId in initNotesModule
    document.dispatchEvent(new CustomEvent('edit-note', {
        detail: { noteId: id }
    }));
    
    // Switch to the main tab
    UIkit.tab(document.getElementById('main-tabs')).show(0);
    
    // Trigger the input event to resize the textarea after switching to MAIN tab
    setTimeout(() => {
        const inputEvent = new Event('input', {
            bubbles: true,
            cancelable: true,
        });
        transcriptionResult.dispatchEvent(inputEvent);
    }, 100);
}

/**
 * Get the note list from localStorage
 * @returns {Array} The note list
 */
function getNoteList() {
    const noteListJson = localStorage.getItem('noteList');
    return noteListJson ? JSON.parse(noteListJson) : [];
}

/**
 * Generate a note ID based on the current date and time
 * Format: YYYY-MM-DD-HH-MM-SS
 * @param {Date} date - The date to use for the ID
 * @returns {string} The generated note ID
 */
function generateNoteId(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} unsafe - The unsafe string
 * @returns {string} The escaped string
 */
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
