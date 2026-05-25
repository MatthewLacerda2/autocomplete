# Aura Write ✦ Inline Autocomplete Text Editor

A lightweight, distraction-free writing environment featuring pixel-perfect inline ghost autocompletions (GitHub Copilot style) powered by **Gemini-3.1-Flash-Lite** and a modern FastAPI Python backend.

## 🚀 How to Run the Project (Docker)

To run this application using Docker:

1. Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   GEMINI_MODEL=gemini-3.1-flash-lite
   ```

2. Start the services:
   ```bash
   docker-compose up --build
   ```

3. Access the application:
   - **Frontend:** http://localhost:8080
   - **Backend API:** http://localhost:3000

---

## 🛠 Manual Launch (for development)

### 1. Backend Server (Port 3000)
To start the FastAPI backend:
```bash
uv run python backend/main.py
```

### 2. Frontend Server
You can serve the `frontend/` folder using any static server (e.g., Python's `http.server` or `live-server`):
```bash
cd frontend && python3 -m http.server 3001
```
