import React, { useState, useEffect, useRef } from 'react'
import {
  Trash2,
  Copy,
  Send,
  Check,
  X
} from 'lucide-react'

// Backend address - resolves dynamically or uses window origin
const BACKEND_URL = window.location.origin

// Slicing and Splicing Utility Helpers for Token Efficiency
function getWordsBeforeCursor(text: string, cursorIndex: number, limit = 200): string {
  const sliced = text.substring(0, cursorIndex)
  const tokens = sliced.split(/(\s+)/)
  let wordCount = 0
  let index = tokens.length - 1
  while (index >= 0 && wordCount < limit) {
    if (tokens[index].trim().length > 0) {
      wordCount++
    }
    index--
  }
  return tokens.slice(index + 1).join('')
}

function getWordsAfterCursor(text: string, cursorIndex: number, limit = 200): string {
  const sliced = text.substring(cursorIndex)
  const tokens = sliced.split(/(\s+)/)
  let wordCount = 0
  let index = 0
  while (index < tokens.length && wordCount < limit) {
    if (tokens[index].trim().length > 0) {
      wordCount++
    }
    index++
  }
  return tokens.slice(0, index).join('')
}

interface EditBlock {
  start_line: number
  end_line: number
  replacement_content: string
}

function applyBlockEdits(originalText: string, edits: EditBlock[]): string {
  if (!edits || edits.length === 0) return originalText
  const lines = originalText.split('\n')
  
  const sortedEdits = [...edits].sort((a, b) => b.start_line - a.start_line)
  
  sortedEdits.forEach(edit => {
    const start = Math.max(1, edit.start_line) - 1
    const end = Math.min(lines.length, edit.end_line)
    const replacementLines = edit.replacement_content.split('\n')
    const count = Math.max(0, end - start)
    lines.splice(start, count, ...replacementLines)
  })
  
  return lines.join('\n')
}

// HTML escaping
function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Markdown compiler for preview rendering
function compileMarkdown(text: string): string {
  let html = escapeHTML(text)
  
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/^- (.*?)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>')
  html = html.replace(/`(.*?)`/g, '<code>$1</code>')
  html = html.replace(/^---$/gm, '<hr>')
  
  const paragraphs = html.split('\n').map(line => {
    const trimmed = line.trim()
    if (trimmed === '') return '<br>'
    if (trimmed.startsWith('<h') || 
        trimmed.startsWith('<u') || 
        trimmed.startsWith('<o') || 
        trimmed.startsWith('<l') || 
        trimmed.startsWith('<hr')) {
      return line
    }
    return `<p>${line}</p>`
  }).join('')
  
  return paragraphs
}

interface ChatMessage {
  role: 'user' | 'model'
  content: string
}

interface Document {
  id: string
  text: string
  chatHistory: ChatMessage[]
  chatContext: string
}

export default function App() {
  // App Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Document State
  const [documents, setDocuments] = useState<Document[]>([])
  const [activeDocId, setActiveDocId] = useState<string>('new')
  const [text, setText] = useState<string>('')
  
  // Chat Sidebar State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [currentChatContext, setCurrentChatContext] = useState<string>('')
  const [chatInput, setChatInput] = useState<string>('')
  const [isChatOpen, setIsChatOpen] = useState<boolean>(true)
  
  // Toggles and settings state
  const [activeModel, setActiveModel] = useState<string>('gemini-3.1-flash-lite')
  const [isMarkdownActive, setIsMarkdownActive] = useState<boolean>(false)
  
  // Autocomplete and Loading State
  const [activeSuggestion, setActiveSuggestion] = useState<string>('')
  const [baseText, setBaseText] = useState<string>('')
  const [fullPredictedText, setFullPredictedText] = useState<string>('')
  const [autocompleteState, setAutocompleteState] = useState<string>('Ready')
  const [autocompleteIndicator, setAutocompleteIndicator] = useState<'idle' | 'fetching' | 'ready'>('idle')
  
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(true)
  const [isFetchingAutocomplete, setIsFetchingAutocomplete] = useState<boolean>(false)
  const [isFetchingChat, setIsFetchingChat] = useState<boolean>(false)
  const [isCopySuccess, setIsCopySuccess] = useState<boolean>(false)
  


  // Timer reference for debounce autocomplete triggers
  const debounceTimer = useRef<any>(null)

  // 1. Initial Load of Documents from Storage
  useEffect(() => {
    try {
      const storedDocs = localStorage.getItem('aura_write_documents')
      const storedActiveId = localStorage.getItem('aura_write_active_doc_id')
      const savedChatOpen = localStorage.getItem('aura_write_chat_open')

      if (storedDocs) {
        const parsed = JSON.parse(storedDocs) as Document[]
        setDocuments(parsed)
        
        if (storedActiveId && parsed.some(d => d.id === storedActiveId)) {
          setActiveDocId(storedActiveId)
          const doc = parsed.find(d => d.id === storedActiveId)
          if (doc) {
            setText(doc.text)
            setChatHistory(doc.chatHistory || [])
            setCurrentChatContext(doc.chatContext || '')
          }
        }
      }

      if (savedChatOpen === 'false') {
        setIsChatOpen(false)
      }
    } catch (e) {
      console.error('Failed to load documents from LocalStorage:', e)
    }

    // Health check
    fetch(`${BACKEND_URL}/health`)
      .then(res => {
        if (!res.ok) setIsBackendConnected(false)
      })
      .catch(() => setIsBackendConnected(false))
  }, [])

  // 2. Synchronize Active Document Autosave
  const saveDocuments = (updatedDocs: Document[], currentActiveId: string) => {
    setDocuments(updatedDocs)
    localStorage.setItem('aura_write_documents', JSON.stringify(updatedDocs))
    localStorage.setItem('aura_write_active_doc_id', currentActiveId)
  }

  const updateActiveDocument = (currentText: string, currentHistory: ChatMessage[], currentContext: string) => {
    const hasText = currentText.trim().length > 0
    const hasChat = currentHistory.length > 0

    if (!hasText && !hasChat) {
      if (activeDocId !== 'new') {
        const updated = documents.filter(d => d.id !== activeDocId)
        setActiveDocId('new')
        saveDocuments(updated, 'new')
      }
      return
    }

    let updatedDocs = [...documents]
    let targetId = activeDocId

    if (activeDocId === 'new') {
      const newId = `doc_${Date.now()}`
      targetId = newId
      const newDoc: Document = {
        id: newId,
        text: currentText,
        chatHistory: currentHistory,
        chatContext: currentContext
      }
      updatedDocs.push(newDoc)
      setActiveDocId(newId)
    } else {
      const index = updatedDocs.findIndex(d => d.id === activeDocId)
      if (index !== -1) {
        updatedDocs[index] = {
          ...updatedDocs[index],
          text: currentText,
          chatHistory: currentHistory,
          chatContext: currentContext
        }
      } else {
        const newDoc: Document = {
          id: activeDocId,
          text: currentText,
          chatHistory: currentHistory,
          chatContext: currentContext
        }
        updatedDocs.push(newDoc)
      }
    }

    saveDocuments(updatedDocs, targetId)
  }

  // 3. Switch Documents handler
  const handleDocumentChange = (newId: string) => {
    clearSuggestion()
    if (newId === 'new') {
      setActiveDocId('new')
      setText('')
      setChatHistory([])
      setCurrentChatContext('')
      localStorage.setItem('aura_write_active_doc_id', 'new')
      if (textareaRef.current) textareaRef.current.focus()
    } else {
      const doc = documents.find(d => d.id === newId)
      if (doc) {
        setActiveDocId(newId)
        setText(doc.text || '')
        setChatHistory(doc.chatHistory || [])
        setCurrentChatContext(doc.chatContext || '')
        localStorage.setItem('aura_write_active_doc_id', newId)
        if (textareaRef.current) textareaRef.current.focus()
      }
    }
  }

  // 4. Autocomplete operations
  const clearSuggestion = () => {
    setActiveSuggestion('')
    setBaseText('')
    setFullPredictedText('')
    setAutocompleteState('Ready')
    setAutocompleteIndicator('idle')
  }

  const fetchAutocompleteSuggestion = async (currentText: string, cursorIndex: number) => {
    if (!isBackendConnected || isFetchingAutocomplete) return

    const textBeforeCursor = currentText.substring(0, cursorIndex)
    if (!textBeforeCursor.trim()) {
      clearSuggestion()
      return
    }

    const slicedBefore = getWordsBeforeCursor(currentText, cursorIndex, 200)
    const slicedAfter = getWordsAfterCursor(currentText, cursorIndex, 200)

    setIsFetchingAutocomplete(true)
    setAutocompleteState('Fetching...')
    setAutocompleteIndicator('fetching')

    try {
      const res = await fetch(`${BACKEND_URL}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_before_cursor: slicedBefore,
          text_after_cursor: slicedAfter,
          model: activeModel,
          chat_context: currentChatContext
        })
      })

      if (res.ok) {
        const data = await res.json()
        const suggestion = data.completion as string

        if (suggestion && suggestion.length > 0) {
          setActiveSuggestion(suggestion)
          setBaseText(textBeforeCursor)
          setFullPredictedText(textBeforeCursor + suggestion)
          setAutocompleteState('Suggestion ready (Tab)')
          setAutocompleteIndicator('ready')
        } else {
          clearSuggestion()
          setAutocompleteState('No suggestion')
        }
      } else {
        clearSuggestion()
        setAutocompleteState('API error')
      }
    } catch (error) {
      console.error('Error fetching autocomplete:', error)
      clearSuggestion()
      setAutocompleteState('Offline')
    } finally {
      setIsFetchingAutocomplete(false)
    }
  }

  const acceptSuggestion = () => {
    if (activeSuggestion && textareaRef.current) {
      const startPos = textareaRef.current.selectionStart
      const endPos = textareaRef.current.selectionEnd
      const currentVal = textareaRef.current.value

      const updatedVal = currentVal.substring(0, startPos) + activeSuggestion + currentVal.substring(endPos)
      setText(updatedVal)

      const newCursor = startPos + activeSuggestion.length
      
      clearSuggestion()
      setAutocompleteState('Completed!')
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.value = updatedVal
          textareaRef.current.setSelectionRange(newCursor, newCursor)
          textareaRef.current.focus()
        }
        updateActiveDocument(updatedVal, chatHistory, currentChatContext)
      }, 0)

      setTimeout(() => {
        setAutocompleteState('Ready')
      }, 1000)
    }
  }

  // 5. Handle editor typing & debounce
  const handleEditorInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)

    const cursorIndex = e.target.selectionStart

    // Autocomplete ghost prefix matching logic
    if (
      activeSuggestion &&
      fullPredictedText.startsWith(val) &&
      val.startsWith(baseText)
    ) {
      const localSuggestion = fullPredictedText.substring(val.length)
      setActiveSuggestion(localSuggestion)
      if (localSuggestion) {
        setAutocompleteState('Suggestion ready (Tab)')
        setAutocompleteIndicator('ready')
      } else {
        setAutocompleteState('Ready')
        setAutocompleteIndicator('idle')
      }
      updateActiveDocument(val, chatHistory, currentChatContext)
      
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      return
    }

    if (activeSuggestion) {
      clearSuggestion()
    }

    setAutocompleteState('Typing...')
    setAutocompleteIndicator('idle')
    updateActiveDocument(val, chatHistory, currentChatContext)

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    
    debounceTimer.current = setTimeout(() => {
      if (val.trim().length > 0) {
        fetchAutocompleteSuggestion(val, cursorIndex)
      } else {
        setAutocompleteState('Ready')
      }
    }, 150)
  }

  // Handle Tab and Esc keys
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      if (activeSuggestion) {
        e.preventDefault()
        acceptSuggestion()
      }
    }

    if (e.key === 'Escape') {
      if (activeSuggestion) {
        e.preventDefault()
        clearSuggestion()
        setAutocompleteState('Dismissed')
        setTimeout(() => {
          setAutocompleteState('Ready')
        }, 1500)
      }
    }
  }

  // Scrolling synchronization
  const syncScrolling = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  // Copy document text
  const handleCopyDocument = () => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setIsCopySuccess(true)
      setTimeout(() => setIsCopySuccess(false), 1800)
    })
  }

  // Clear document text
  const handleClearDocument = () => {
    if (window.confirm('Are you sure you want to clear your current document?')) {
      setText('')
      clearSuggestion()
      setAutocompleteState('Ready')
      updateActiveDocument('', chatHistory, currentChatContext)
      if (textareaRef.current) textareaRef.current.focus()
    }
  }

  // 6. Interactive Writing Chatbot Assistant Control
  const sendChatMessage = async () => {
    const message = chatInput.trim()
    if (!message || isFetchingChat) return

    setChatInput('')
    const userMsg: ChatMessage = { role: 'user', content: message }
    const updatedHistory = [...chatHistory, userMsg]
    
    setChatHistory(updatedHistory)
    setIsFetchingChat(true)
    
    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 50)

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          current_text: text,
          history: chatHistory,
          model: activeModel,
          chat_context: currentChatContext
        })
      })

      if (res.ok) {
        const data = await res.json()
        const modelMsg: ChatMessage = { role: 'model', content: data.chat_response }
        const nextHistory = [...updatedHistory, modelMsg]

        setChatHistory(nextHistory)

        if (data.updated_context !== null && data.updated_context !== undefined) {
          setCurrentChatContext(data.updated_context)
        }

        if (data.edits !== null && data.edits !== undefined && data.edits.length > 0) {
          const editedText = applyBlockEdits(text, data.edits)
          
          setText(editedText)
          clearSuggestion()
          
          updateActiveDocument(editedText, nextHistory, data.updated_context ?? currentChatContext)
        } else {
          updateActiveDocument(text, nextHistory, data.updated_context ?? currentChatContext)
        }
      } else {
        setChatHistory(prev => [
          ...prev, 
          { role: 'model', content: 'Sorry, I encountered an error communicating with the chat model.' }
        ])
      }
    } catch (err) {
      console.error('Error sending chat message:', err)
      setChatHistory(prev => [
        ...prev, 
        { role: 'model', content: 'Connection lost. Please make sure the backend is running.' }
      ])
    } finally {
      setIsFetchingChat(false)
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    }
  }

  // Clear Context Summary
  const handleClearContext = () => {
    if (window.confirm('Are you sure you want to clear the structure context for this document?')) {
      setCurrentChatContext('')
      updateActiveDocument(text, chatHistory, '')
    }
  }

  // Reset Chat Messages only
  const handleClearChat = () => {
    setChatHistory([])
    updateActiveDocument(text, [], currentChatContext)
  }

  // Document Name Resolver
  const getDocumentName = (doc: Document) => {
    if (doc.text && doc.text.trim().length > 0) {
      const firstLine = doc.text.trim().split('\n')[0]
      return firstLine.substring(0, 25) + (firstLine.length > 25 ? '...' : '')
    }
    if (doc.chatHistory && doc.chatHistory.length > 0) {
      const firstUserMsg = doc.chatHistory.find(m => m.role === 'user')
      if (firstUserMsg) {
        const content = firstUserMsg.content.trim()
        return content.substring(0, 25) + (content.length > 25 ? '...' : '')
      }
    }
    return 'Untitled Document'
  }

  // Word and character stats
  const characterCount = text.length
  const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).filter(w => w.length > 0).length

  // Chat open toggle
  const toggleChat = () => {
    const nextState = !isChatOpen
    setIsChatOpen(nextState)
    localStorage.setItem('aura_write_chat_open', String(nextState))
  }

  return (
    <div className="app-container">
      {/* Workspace Panel Split */}
      <div className={`workspace-wrapper ${isChatOpen ? 'chat-open' : ''}`}>
        
        {/* Left Side: Text Editor Workspace */}
        <main className="editor-section">
          <div 
            id="editor-card"
            className="editor-glass-card"
          >
            {/* Toolbar Header */}
            <div className="editor-toolbar">
              <div className="toolbar-left">
                {/* Markdown Toggle - switches visualization mode in-place */}
                <button 
                  onClick={() => setIsMarkdownActive(!isMarkdownActive)}
                  className={`toggle-badge ${isMarkdownActive ? 'active' : ''}`}
                  title="Toggle Markdown Visualization"
                >
                  <span className="toggle-indicator"></span>
                  <span className="btn-text">Markdown Preview</span>
                </button>

                {/* Switch Model Badge */}
                <button 
                  onClick={() => {
                    const nextModel = activeModel === 'gemini-3.1-flash-lite' ? 'gemini-3.5-flash' : 'gemini-3.1-flash-lite'
                    setActiveModel(nextModel)
                    clearSuggestion()
                  }}
                  className="toggle-badge font-mono"
                  title="Click to switch models"
                  style={{
                    borderColor: activeModel === 'gemini-3.5-flash' ? 'rgba(6, 182, 212, 0.3)' : '',
                    color: activeModel === 'gemini-3.5-flash' ? 'var(--accent-cyan)' : ''
                  }}
                >
                  🤖 <span className="btn-text">{activeModel}</span>
                </button>
                
                {/* Premium Document Selector */}
                <div className="document-selector-container">
                  <span className="doc-label hide-mobile">DOC:</span>
                  <select 
                    value={activeDocId}
                    onChange={(e) => handleDocumentChange(e.target.value)}
                    className="document-select"
                    title="Switch between active documents"
                  >
                    <option value="new">✦ New Document</option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        📄 {getDocumentName(doc)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toolbar Right Actions */}
              <div className="toolbar-right">
                <button 
                  onClick={toggleChat}
                  className={`toggle-badge ${isChatOpen ? 'active' : ''}`}
                  title="Toggle Assistant Chat"
                >
                  💬 <span className="btn-text">Assistant</span>
                </button>
                
                <button className="icon-btn" onClick={handleClearDocument} title="Clear text">
                  <Trash2 className="w-4 h-4" />
                </button>
                
                <button className="icon-btn" onClick={handleCopyDocument} title="Copy to clipboard">
                  {isCopySuccess ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Main Editor Workspace */}
            <div className="editor-workspace-split">
              {/* Double-Layer synchronized textarea overlay */}
              <div className="editor-container relative flex-1 h-full">
                {isMarkdownActive ? (
                  /* Markdown visualization mode: render markdown in-place, still editable */
                  <>
                    <div 
                      className="markdown-content"
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
                      dangerouslySetInnerHTML={{ __html: compileMarkdown(text) }}
                    />
                    <textarea 
                      ref={textareaRef}
                      value={text}
                      onChange={handleEditorInput}
                      onKeyDown={handleEditorKeyDown}
                      onScroll={syncScrolling}
                      placeholder="Start typing..." 
                      spellCheck="false"
                      autoComplete="off"
                      className="editor-textarea"
                      style={{ color: 'transparent', caretColor: 'var(--accent-sky)' }}
                      autoFocus
                    />
                  </>
                ) : (
                  /* Normal text mode: plain text with ghost autocomplete overlay */
                  <>
                    <div 
                      ref={backdropRef}
                      className="editor-mirrored-backdrop"
                      dangerouslySetInnerHTML={{
                        __html: text.endsWith('\n') 
                          ? escapeHTML(text) + '\u200b' + (activeSuggestion ? `<span class="suggestion-ghost">${escapeHTML(activeSuggestion)}</span>` : '')
                          : escapeHTML(text) + (activeSuggestion ? `<span class="suggestion-ghost">${escapeHTML(activeSuggestion)}</span>` : '')
                      }}
                    />
                    <textarea 
                      ref={textareaRef}
                      value={text}
                      onChange={handleEditorInput}
                      onKeyDown={handleEditorKeyDown}
                      onScroll={syncScrolling}
                      placeholder="Start typing your story, exam structure, or document here... Pause typing to trigger autocomplete suggestions, or chat with the assistant on the right." 
                      spellCheck="false"
                      autoComplete="off"
                      className="editor-textarea"
                      autoFocus
                    />
                  </>
                )}
              </div>
            </div>

            {/* Editor Footer Panel */}
            <div className="editor-footer">
              <div className="footer-left">
                <span className="stat-item"><strong>{wordCount}</strong> words</span>
                <span className="stat-divider">|</span>
                <span className="stat-item"><strong>{characterCount}</strong> characters</span>
                <span className="stat-divider">|</span>
                <span className="autocomplete-status">
                  <span className={`status-dot ${
                    autocompleteIndicator === 'fetching' 
                      ? 'fetching'
                      : autocompleteIndicator === 'ready'
                      ? 'ready'
                      : 'idle'
                  }`}></span>
                  {autocompleteState}
                </span>
              </div>
              <div className="footer-right">
                {activeSuggestion && (
                  <button 
                    onClick={acceptSuggestion}
                    className="footer-action-btn visible"
                  >
                    Accept (Tab)
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* Right Side: Aura Writing Assistant Sidebar */}
        <aside className="chat-sidebar-section">
          <div className="chat-glass-card">
            {/* Sidebar close button */}
            <div className="chat-sidebar-close-row">
              <button 
                onClick={toggleChat}
                className="icon-btn" 
                title="Close sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Structural Context Summary Panel */}
            {currentChatContext && currentChatContext.trim().length > 0 && (
              <div className="chat-context-panel">
                <div className="context-panel-header">
                  <span className="context-panel-title">📋 Document Structure & Context</span>
                  <button className="context-clear-btn" onClick={handleClearContext} title="Clear structure context">Clear</button>
                </div>
                <div className="context-panel-body">
                  {currentChatContext.trim()}
                </div>
              </div>
            )}

            {/* Sub-Header Actions */}
            <div className="chat-messages-header">
              <span className="chat-messages-title">✦ Messages</span>
              <button className="chat-reset-btn" onClick={handleClearChat} title="Reset chat history (keeps document context)">Reset Chat</button>
            </div>

            {/* Chat Message Bubble Log */}
            <div className="chat-messages-container">
              {chatHistory.length === 0 ? (
                <div className="empty-chat-hint">
                  No active messages. Chat with Aura to outline your ideas, draft content, or expand and edit your document inline.
                </div>
              ) : (
                chatHistory.map((msg, index) => (
                  <div 
                    key={index}
                    className={`message ${
                      msg.role === 'user' ? 'user-message' : 'assistant-message'
                    }`}
                  >
                    <span className="message-sender">
                      {msg.role === 'user' ? '✦ You' : '✦ Aura'}
                    </span>
                    <div 
                      className="message-content"
                      dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br>') }}
                    />
                  </div>
                ))
              )}
              {isFetchingChat && (
                <div className="message assistant-message">
                  <span className="message-sender">✦ Aura</span>
                  <div className="typing-indicator">
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Text Box Input */}
            <div className="chat-input-wrapper">
              <textarea 
                value={chatInput}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setChatInput(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendChatMessage()
                  }
                }}
                placeholder="Ask the assistant to draft, format, or restructure..."
                rows={2}
                className="chat-textarea-input"
              />
              <button 
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || isFetchingChat}
                className="chat-send-btn"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
