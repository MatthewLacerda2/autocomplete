# Aura Write ✦ Inline Autocomplete Text Editor

A lightweight, distraction-free writing environment featuring pixel-perfect inline ghost autocompletions (GitHub Copilot style) powered by **Gemini-3.1-Flash-Lite** (falling back gracefully to standard `gemini-2.5-flash` if needed) and a modern FastAPI Python backend.

---

## 🚀 How to Run the Project

Since the project is already configured with `uv`, launching it is extremely simple. Both servers have been launched automatically for you, but here are the manual start commands for your reference:

### 1. Backend Server (Port 3000)
To start the FastAPI backend:
```bash
uv run python backend/main.py
```
*Accessible at: `http://localhost:3000` (Health Check: `http://localhost:3000/health`)*

### 2. Frontend Server (Port 3001)
To serve the static web assets (HTML/CSS/JS):
```bash
uv run python -m http.server --directory frontend 3001
```
*Accessible at: `http://localhost:3001`*

---

## 🎨 Features & UX Design

- **Ghost Text Autocompletions**: Muted, semi-transparent completion text appears inline trailing your typing cursor.
- **Tab to Accept**: Press the <kbd>Tab</kbd> key when an autocomplete suggestion is visible to instantly append it.
- **Escape to Dismiss**: Press the <kbd>Esc</kbd> key to instantly clear a suggestion you don't wish to use.
- **Smart Debouncing**: An intelligent 400ms delay after typing prevents API rate limits and feels organic.
- **Premium Glassmorphic UI**: Gorgeous space dark theme with animated glowing iconography, harmonized Outfit/Inter typography, and subtle reactive glows.
- **Real-Time Word & Character Count**: Track your writing statistics instantly.
- **Quick Controls**: Copy your entire written draft with a single click (includes a visual success checkmark) or clear the editor workspace cleanly.

---

## 🔧 Environment Configuration

You can customize the project in the `.env` file located in the root of your workspace:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite  # Options: gemini-3.1-flash-lite, gemini-2.5-flash
PORT=3000
```

---

## 🛠️ Architecture Details

### Mirrored Layer Technique
To achieve high-fidelity inline autocomplete *without* heavy external libraries (like React or CodeMirror), Aura Write uses a custom-engineered **mirrored double-layer textarea**:
1. A parent container with a relative layout holds a standard, highly performant `<textarea>` layered on top of a mirrored background `<div>`.
2. The `<textarea>` text color is set to white, with its background completely transparent.
3. The background `<div>` mirrors the typed text exactly (synchronized down to padding, borders, line-height, and word breaks) but styles the text as `transparent`.
4. When a suggestion is returned from Gemini, it is appended to the background `<div>` inside a `<span class="suggestion-ghost">` tag styled with semi-transparent, light-gray gradient text.
5. High-frequency scroll-synchronization ensures that suggestions stay aligned perfectly even in large scrollable documents!
