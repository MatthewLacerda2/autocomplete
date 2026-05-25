// Configuration - Dynamically resolves hostname for full local WiFi compatibility
const BACKEND_URL = `${window.location.protocol}//${window.location.hostname}:3000`;
const DEBOUNCE_DELAY = 150; // Ultra-fast autocomplete trigger delay

// DOM Elements
const textarea = document.getElementById('editor-textarea');
const backdrop = document.getElementById('mirrored-backdrop');
const wordCount = document.getElementById('word-count');
const charCount = document.getElementById('char-count');
const backendStatus = document.getElementById('backend-status');
const autocompleteIndicator = document.getElementById('autocomplete-indicator');
const btnClear = document.getElementById('btn-clear');
const btnCopy = document.getElementById('btn-copy');

// Interactive Toggle Switchers
const btnToggleMarkdown = document.getElementById('btn-toggle-markdown');
const btnToggleModel = document.getElementById('btn-toggle-model');
const modelLabel = document.getElementById('current-model-label');
const markdownPreviewPane = document.getElementById('markdown-preview-pane');
const markdownPreviewContent = document.getElementById('markdown-preview-content');
const editorWorkspaceSplit = document.querySelector('.editor-workspace-split');

// Chat Sidebar Elements
const chatMessagesContainer = document.getElementById('chat-messages');
const chatTextarea = document.getElementById('chat-textarea');
const btnSendChat = document.getElementById('btn-send-chat');

// Application State
let activeSuggestion = '';
let baseText = '';
let fullPredictedText = '';
let debounceTimeout = null;

let isBackendConnected = false;
let isFetchingAutocomplete = false;
let isFetchingChat = false;

// New state variables for toggles
let activeModel = 'gemini-3.1-flash-lite';
let isMarkdownPreviewActive = false;
let chatHistory = []; // stores conversation context: { role: 'user' | 'model', content: string }

// Document management state variables
let documents = []; // Array of { id: string, text: string, chatHistory: Array, chatContext: string }
let activeDocId = 'new'; // 'new' or specific doc ID
let currentChatContext = ''; // structure & about of active document

// LocalStorage Persistence Helpers
function loadDocumentsFromStorage() {
    try {
        const stored = localStorage.getItem('aura_write_documents');
        if (stored) {
            documents = JSON.parse(stored);
        } else {
            documents = [];
        }
        
        const storedActiveId = localStorage.getItem('aura_write_active_doc_id');
        if (storedActiveId && documents.some(d => d.id === storedActiveId)) {
            activeDocId = storedActiveId;
        } else {
            activeDocId = 'new';
        }
    } catch (e) {
        console.error('Failed to load documents from localStorage:', e);
        documents = [];
        activeDocId = 'new';
    }
}

function saveDocumentsToStorage() {
    try {
        localStorage.setItem('aura_write_documents', JSON.stringify(documents));
        localStorage.setItem('aura_write_active_doc_id', activeDocId);
    } catch (e) {
        console.error('Failed to save documents to localStorage:', e);
    }
}

function getDocumentName(doc) {
    if (doc.text && doc.text.trim().length > 0) {
        const firstLine = doc.text.trim().split('\n')[0];
        return firstLine.substring(0, 25) + (firstLine.length > 25 ? '...' : '');
    }
    
    if (doc.chatHistory && doc.chatHistory.length > 0) {
        const firstUserMsg = doc.chatHistory.find(m => m.role === 'user');
        if (firstUserMsg) {
            const text = firstUserMsg.content.trim();
            return text.substring(0, 25) + (text.length > 25 ? '...' : '');
        }
    }
    
    return 'Untitled Document';
}

function renderDocumentDropdown() {
    const select = document.getElementById('select-document');
    if (!select) return;
    
    let html = `<option value="new" ${activeDocId === 'new' ? 'selected' : ''}>✦ New Document</option>`;
    
    documents.forEach(doc => {
        const name = getDocumentName(doc);
        html += `<option value="${doc.id}" ${activeDocId === doc.id ? 'selected' : ''}>📄 ${name}</option>`;
    });
    
    select.innerHTML = html;
}

function updateContextPanelUI() {
    const panel = document.getElementById('chat-context-panel');
    const body = document.getElementById('context-body');
    if (!panel || !body) return;
    
    if (currentChatContext && currentChatContext.trim().length > 0) {
        body.textContent = currentChatContext.trim();
    } else {
        body.textContent = 'No structure or context defined yet. Chat with Aura to outline your document, and the autocomplete will automatically follow it.';
    }
}

function updateActiveDocument() {
    const currentText = textarea.value;
    const hasText = currentText.trim().length > 0;
    const hasChat = chatHistory.length > 0;
    
    if (!hasText && !hasChat) {
        if (activeDocId !== 'new') {
            const index = documents.findIndex(d => d.id === activeDocId);
            if (index !== -1) {
                documents.splice(index, 1);
                activeDocId = 'new';
                saveDocumentsToStorage();
                renderDocumentDropdown();
                resetChatUI();
                updateContextPanelUI();
            }
        }
        return;
    }
    
    if (activeDocId === 'new') {
        const newDocId = `doc_${Date.now()}`;
        const newDoc = {
            id: newDocId,
            text: currentText,
            chatHistory: [...chatHistory],
            chatContext: currentChatContext
        };
        documents.push(newDoc);
        activeDocId = newDocId;
    } else {
        const doc = documents.find(d => d.id === activeDocId);
        if (doc) {
            doc.text = currentText;
            doc.chatHistory = [...chatHistory];
            doc.chatContext = currentChatContext;
        } else {
            const newDoc = {
                id: activeDocId,
                text: currentText,
                chatHistory: [...chatHistory],
                chatContext: currentChatContext
            };
            documents.push(newDoc);
        }
    }
    
    saveDocumentsToStorage();
    renderDocumentDropdown();
}

function resetChatUI() {
    chatMessagesContainer.innerHTML = '';
    chatMessagesContainer.scrollTop = 0;
}

function rebuildChatUI() {
    chatMessagesContainer.innerHTML = '';
    
    if (chatHistory.length === 0) {
        resetChatUI();
        return;
    }
    
    chatHistory.forEach(msg => {
        appendChatMessage(msg.role, msg.content);
    });
}

async function handleDocumentChange(newId) {
    clearSuggestion();
    
    if (newId === 'new') {
        activeDocId = 'new';
        textarea.value = '';
        chatHistory = [];
        currentChatContext = '';
        
        resetChatUI();
        updateContextPanelUI();
        renderBackdrop();
        textarea.focus();
    } else {
        const doc = documents.find(d => d.id === newId);
        if (doc) {
            activeDocId = newId;
            textarea.value = doc.text || '';
            chatHistory = doc.chatHistory || [];
            currentChatContext = doc.chatContext || '';
            
            rebuildChatUI();
            updateContextPanelUI();
            renderBackdrop();
            textarea.focus();
        }
    }
    
    localStorage.setItem('aura_write_active_doc_id', activeDocId);
}

// 1. Connection check and Status
async function checkBackendHealth() {
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        if (response.ok) {
            const data = await response.json();
            setBackendStatus(true, `Connected // WiFi Active`);
        } else {
            setBackendStatus(false, 'Status error');
        }
    } catch (error) {
        console.error('Failed to connect to backend:', error);
        setBackendStatus(false, 'Offline - API unreachable');
    }
}

function setBackendStatus(connected, message) {
    isBackendConnected = connected;
    if (!backendStatus) return; // Safeguard if status element is removed
    
    const indicator = backendStatus.querySelector('.status-indicator');
    const text = backendStatus.querySelector('.status-text');
    
    indicator.className = 'status-indicator';
    if (connected) {
        indicator.classList.add('online');
        text.textContent = message;
    } else {
        indicator.classList.add('offline');
        text.textContent = message;
    }
}

// 2. Clickable Switchers & Toggles Control

// Model Toggler
btnToggleModel.addEventListener('click', () => {
    if (activeModel === 'gemini-3.1-flash-lite') {
        activeModel = 'gemini-3.5-flash';
        btnToggleModel.classList.remove('model-lite');
        btnToggleModel.style.borderColor = 'rgba(6, 182, 212, 0.3)';
        btnToggleModel.style.color = 'var(--accent-cyan)';
    } else {
        activeModel = 'gemini-3.1-flash-lite';
        btnToggleModel.classList.add('model-lite');
        btnToggleModel.style.borderColor = '';
        btnToggleModel.style.color = '';
    }
    modelLabel.textContent = activeModel;
    
    // Fire autocomplete immediately using the new model if text is present
    if (textarea.value.trim().length > 0) {
        clearSuggestion();
        fetchAutocompleteSuggestion();
    }
});

// Markdown Split-Preview Toggler
btnToggleMarkdown.addEventListener('click', () => {
    isMarkdownPreviewActive = !isMarkdownPreviewActive;
    
    if (isMarkdownPreviewActive) {
        btnToggleMarkdown.classList.add('active');
        editorWorkspaceSplit.classList.add('markdown-active');
        renderMarkdownPreview();
    } else {
        btnToggleMarkdown.classList.remove('active');
        editorWorkspaceSplit.classList.remove('markdown-active');
    }
    
    // Force sync scrolling on toggle
    syncScrolling();
});

// 3. Custom Markdown Compiler
function escapeHTML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderMarkdownPreview() {
    if (!isMarkdownPreviewActive) return;
    
    const text = textarea.value;
    
    // Escaped HTML basis
    let html = escapeHTML(text);
    
    // Simple custom regex-based markdown parser
    // 1. Headers (#)
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    
    // 2. Bold (**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 3. Bullet List (- item)
    html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
    
    // Group consecutive list items into ul list blocks
    html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
    
    // 4. Code Blocks (`code`)
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    
    // 5. Horizontal rule (---)
    html = html.replace(/^---$/gm, '<hr>');
    
    // 6. Format standard text blocks and paragraphs
    const paragraphs = html.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed === '') return '<br>';
        
        // Skip enclosing paragraph tag if it's already an HTML structure we generated
        if (trimmed.startsWith('<h') || 
            trimmed.startsWith('<u') || 
            trimmed.startsWith('<o') || 
            trimmed.startsWith('<l') || 
            trimmed.startsWith('<hr')) {
            return line;
        }
        return `<p>${line}</p>`;
    }).join('');
    
    markdownPreviewContent.innerHTML = paragraphs;
}

// 4. Double-Layer Editor Renderer
function renderBackdrop() {
    const text = textarea.value;
    
    // Calculate character and word count
    updateCounts(text);
    
    // Sync live markdown split preview
    renderMarkdownPreview();
    
    let escapedText = escapeHTML(text);
    
    // Mirror scroll newline matching fix
    if (text.endsWith('\n')) {
        escapedText += '\u200b';
    }
    
    if (activeSuggestion) {
        const escapedSuggestion = escapeHTML(activeSuggestion);
        backdrop.innerHTML = `${escapedText}<span class="suggestion-ghost">${escapedSuggestion}</span>`;
    } else {
        backdrop.innerHTML = escapedText;
    }
    
    syncScrolling();
}

function syncScrolling() {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
}

function updateCounts(text) {
    charCount.textContent = text.length;
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    wordCount.textContent = words.length;
}

// 5. Autocomplete State Control
function setAutocompleteState(state, message) {
    if (!autocompleteIndicator) return; // Safeguard if indicator is removed
    autocompleteIndicator.className = 'autocomplete-state-indicator';
    autocompleteIndicator.classList.add(`state-${state}`);
    
    const msgElement = autocompleteIndicator.querySelector('.indicator-message');
    msgElement.textContent = message;
}

// Fetch suggestion from Backend
async function fetchAutocompleteSuggestion() {
    if (!isBackendConnected || isFetchingAutocomplete) {
        return;
    }
    
    const textBeforeCursor = textarea.value;
    
    if (!textBeforeCursor.trim()) {
        clearSuggestion();
        setAutocompleteState('idle', 'Ready');
        return;
    }
    
    isFetchingAutocomplete = true;
    setAutocompleteState('fetching', 'Fetching...');
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                text_before_cursor: textBeforeCursor,
                model: activeModel,
                chat_context: currentChatContext
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const suggestion = data.completion;
            
            if (suggestion && suggestion.length > 0) {
                activeSuggestion = suggestion;
                baseText = textBeforeCursor;
                fullPredictedText = baseText + activeSuggestion;
                
                setAutocompleteState('ready', 'Suggestion ready (Tab)');
                renderBackdrop();
            } else {
                clearSuggestion();
                setAutocompleteState('idle', 'No suggestion');
            }
        } else {
            clearSuggestion();
            setAutocompleteState('idle', 'API error');
        }
    } catch (error) {
        console.error('Error fetching autocomplete:', error);
        clearSuggestion();
        setAutocompleteState('idle', 'Offline');
    } finally {
        isFetchingAutocomplete = false;
    }
}

function clearSuggestion() {
    activeSuggestion = '';
    baseText = '';
    fullPredictedText = '';
    renderBackdrop();
}


// 6. Interactive Writing Chatbot Assistant Control

// Append a message bubble to the chat sidebar
function appendChatMessage(role, text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
    
    const senderSpan = document.createElement('span');
    senderSpan.classList.add('message-sender');
    senderSpan.textContent = role === 'user' ? '✦ You' : '✦ Aura';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    // Support simple paragraphs in chat bubbles
    contentDiv.innerHTML = text.replace(/\n/g, '<br>');
    
    messageDiv.appendChild(senderSpan);
    messageDiv.appendChild(contentDiv);
    
    chatMessagesContainer.appendChild(messageDiv);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// Typing indicators
let typingBubble = null;
function showChatTypingIndicator() {
    if (typingBubble) return;
    
    typingBubble = document.createElement('div');
    typingBubble.classList.add('message', 'assistant-message');
    
    const senderSpan = document.createElement('span');
    senderSpan.classList.add('message-sender');
    senderSpan.textContent = '✦ Aura';
    
    const typingIndicatorDiv = document.createElement('div');
    typingIndicatorDiv.classList.add('typing-indicator');
    
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('div');
        dot.classList.add('typing-dot');
        typingIndicatorDiv.appendChild(dot);
    }
    
    typingBubble.appendChild(senderSpan);
    typingBubble.appendChild(typingIndicatorDiv);
    chatMessagesContainer.appendChild(typingBubble);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

function hideChatTypingIndicator() {
    if (typingBubble && typingBubble.parentNode) {
        typingBubble.parentNode.removeChild(typingBubble);
    }
    typingBubble = null;
}

// Send chat message
async function sendChatMessage() {
    const message = chatTextarea.value.trim();
    if (!message || isFetchingChat) return;
    
    // Disable inputs
    chatTextarea.value = '';
    chatTextarea.disabled = true;
    btnSendChat.disabled = true;
    
    // Add user message to UI
    appendChatMessage('user', message);
    showChatTypingIndicator();
    
    isFetchingChat = true;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                current_text: textarea.value,
                history: chatHistory,
                model: activeModel,
                chat_context: currentChatContext
            })
        });
        
        hideChatTypingIndicator();
        
        if (response.ok) {
            const data = await response.json();
            
            // Append assistant chat response to UI
            appendChatMessage('model', data.chat_response);
            
            // Maintain chat history context
            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'model', content: data.chat_response });
            
            // Limit history to last 16 messages to keep payloads optimized
            if (chatHistory.length > 16) {
                chatHistory.splice(0, 2);
            }
            
            // CRITICAL: Dynamic structure context update from Chatbot
            if (data.updated_context !== null && data.updated_context !== undefined) {
                currentChatContext = data.updated_context;
                updateContextPanelUI();
                
                const panel = document.getElementById('chat-context-panel');
                if (panel) {
                    panel.style.borderColor = 'var(--accent-cyan)';
                    panel.style.boxShadow = '0 0 12px rgba(6, 182, 212, 0.25)';
                    setTimeout(() => {
                        panel.style.borderColor = '';
                        panel.style.boxShadow = '';
                    }, 1200);
                }
            }
            
            // CRITICAL: Dynamic text update from Chatbot
            if (data.updated_text !== null && data.updated_text !== undefined) {
                // Flash the card border briefly to visually show an update occurred
                const card = document.getElementById('editor-card');
                card.style.borderColor = 'var(--accent-blue)';
                card.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.65), 0 0 0 1px var(--accent-blue)';
                
                // Update editor contents
                textarea.value = data.updated_text;
                
                // Reset suggestion state since text changed
                clearSuggestion();
                renderBackdrop();
                
                setTimeout(() => {
                    card.style.borderColor = '';
                    card.style.boxShadow = '';
                }, 1000);
            }
            
            // Save active document state (which handles creation, updates, and naming)
            updateActiveDocument();
        } else {
            appendChatMessage('model', 'Sorry, I encountered an error communicating with the chat model.');
        }
    } catch (error) {
        console.error('Error sending chat message:', error);
        hideChatTypingIndicator();
        appendChatMessage('model', 'Connection lost. Please make sure the backend is running and you are connected to the network.');
    } finally {
        isFetchingChat = false;
        chatTextarea.disabled = false;
        btnSendChat.disabled = false;
        chatTextarea.focus();
    }
}


// 7. Event Listeners

// Input Listener
textarea.addEventListener('input', () => {
    const currentText = textarea.value;
    
    // "Not going back on its word" - Prefix-Matching Ghost Completion
    // If the user's input matches the start of what we predicted, slice the suggestion locally!
    if (activeSuggestion && 
        fullPredictedText.startsWith(currentText) && 
        currentText.startsWith(baseText)) {
        
        // Update suggestion locally
        activeSuggestion = fullPredictedText.substring(currentText.length);
        
        if (activeSuggestion) {
            setAutocompleteState('ready', 'Suggestion ready (Tab)');
        } else {
            setAutocompleteState('idle', 'Ready');
        }
        
        renderBackdrop();
        
        // Update documents array and save to local storage
        updateActiveDocument();
        
        // Prevent launching new API autocomplete calls
        clearTimeout(debounceTimeout);
        return;
    }
    
    // Otherwise, clear active suggestion and schedule a new debounced fetch
    if (activeSuggestion) {
        clearSuggestion();
    }
    
    setAutocompleteState('idle', 'Typing...');
    renderBackdrop();
    
    // Update documents array and save to local storage
    updateActiveDocument();
    
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
        if (textarea.value.trim().length > 0) {
            fetchAutocompleteSuggestion();
        } else {
            setAutocompleteState('idle', 'Ready');
        }
    }, DEBOUNCE_DELAY);
});

// Scroll synchronization
textarea.addEventListener('scroll', syncScrolling);

// Keyboard overrides for Tab and Esc key capture
textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        if (activeSuggestion) {
            e.preventDefault(); // Intercept indent
            
            // Splice suggestion at caret
            const startPos = textarea.selectionStart;
            const endPos = textarea.selectionEnd;
            const currentVal = textarea.value;
            
            textarea.value = currentVal.substring(0, startPos) + activeSuggestion + currentVal.substring(endPos);
            
            // Move cursor to the end of the suggestion
            const newCursor = startPos + activeSuggestion.length;
            textarea.setSelectionRange(newCursor, newCursor);
            
            clearSuggestion();
            setAutocompleteState('ready', 'Completed!');
            
            renderBackdrop();
            
            // Update document contents inside storage
            updateActiveDocument();
            
            setTimeout(() => {
                setAutocompleteState('idle', 'Ready');
            }, 1000);
        }
    }
    
    if (e.key === 'Escape') {
        if (activeSuggestion) {
            e.preventDefault();
            clearSuggestion();
            setAutocompleteState('idle', 'Dismissed');
            
            setTimeout(() => {
                setAutocompleteState('idle', 'Ready');
            }, 1500);
        }
    }
});

// Clear Document Button
btnClear.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your current document?')) {
        textarea.value = '';
        clearSuggestion();
        setAutocompleteState('idle', 'Ready');
        
        // Auto-save deletes document if chat history is also empty
        updateActiveDocument();
        
        textarea.focus();
    }
});

// Copy Document Button
btnCopy.addEventListener('click', () => {
    if (!textarea.value) return;
    
    navigator.clipboard.writeText(textarea.value).then(() => {
        const oldLabel = btnCopy.innerHTML;
        btnCopy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#10b981" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>`;
        setTimeout(() => {
            btnCopy.innerHTML = oldLabel;
        }, 1800);
    }).catch(err => {
        console.error('Copy failed: ', err);
    });
});

// Chat Submit triggers
btnSendChat.addEventListener('click', sendChatMessage);

chatTextarea.addEventListener('keydown', (e) => {
    // Send message on Enter, but Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

// Document Selector interaction listeners
const selectDocumentDropdown = document.getElementById('select-document');
if (selectDocumentDropdown) {
    selectDocumentDropdown.addEventListener('change', (e) => {
        handleDocumentChange(e.target.value);
    });
}

// Clear Context button listener
const btnClearContext = document.getElementById('btn-clear-context');
if (btnClearContext) {
    btnClearContext.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the structure context for this document?')) {
            currentChatContext = '';
            updateContextPanelUI();
            updateActiveDocument();
        }
    });
}


// 8. Initialization on page load
loadDocumentsFromStorage();
renderDocumentDropdown();

// Load the active document if there is one, otherwise clear
if (activeDocId !== 'new') {
    handleDocumentChange(activeDocId);
} else {
    // Re-render empty backdrop
    renderBackdrop();
    updateContextPanelUI();
}

checkBackendHealth();
setInterval(checkBackendHealth, 8000); // Heartbeat check
