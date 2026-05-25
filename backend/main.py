import os
import logging
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("autocomplete-backend")

# Try loading from local directory or parent directory
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI(title="Gemini Autocomplete & Writing Assistant API")

# Configure CORS for frontend Port 3001
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Read default model and API key from environment
api_key = os.getenv("GEMINI_API_KEY")
default_model_name = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

if not api_key:
    logger.warning("GEMINI_API_KEY is not set in environment or .env file.")

# Initialize the Gemini Client
try:
    if api_key:
        client = genai.Client(api_key=api_key)
    else:
        client = genai.Client()
except Exception as e:
    logger.error(f"Failed to initialize GenAI Client: {e}")
    client = None


# --- Autocomplete Schemas ---
class CompleteRequest(BaseModel):
    text_before_cursor: str
    model: Optional[str] = "gemini-3.1-flash-lite"
    chat_context: Optional[str] = None

class CompleteResponse(BaseModel):
    completion: str


# --- Chat schemas for Structured Outputs ---
class ChatMessage(BaseModel):
    role: str  # 'user' or 'model'
    content: str

class ChatRequest(BaseModel):
    message: str
    current_text: str
    history: List[ChatMessage]
    model: str
    chat_context: Optional[str] = None

class AssistantResponse(BaseModel):
    chat_response: str = Field(
        description="A friendly, helpful, and concise conversational response to the user. "
                    "Briefly explain what changes or additions were made to the document (if any)."
    )
    updated_text: Optional[str] = Field(
        None,
        description="The complete, updated text for the editor. If the user request asks to write, "
                    "rewrite, edit, structure, format, or append text inside the document, you MUST "
                    "output the entire updated document text in this field. If no document changes are "
                    "necessary or requested (e.g., general brainstorming), leave this field as null or omit it."
    )
    updated_context: Optional[str] = Field(
        None,
        description="The updated structure, outline, style, or about context of the document. "
                    "If the user explains the document's structure, outline, or what the document is about, "
                    "or if you infer it from the user's instructions or conversation, you MUST update "
                    "this field with a concise summary/structure of the document. "
                    "If there is no change or update to the structure/context, or if it is not relevant, "
                    "leave this field as null or omit it to be token efficient."
    )


# --- Endpoints ---
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "default_model": default_model_name,
        "api_key_configured": bool(api_key or os.getenv("GEMINI_API_KEY"))
    }


@app.post("/api/complete", response_model=CompleteResponse)
async def get_autocomplete(request: CompleteRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="Gemini API Client is not configured. Please check your GEMINI_API_KEY."
        )
    
    text = request.text_before_cursor
    if not text.strip():
        return CompleteResponse(completion="")

    model_to_use = request.model or default_model_name
    
    # We construct a strict system instruction to ensure the model behaves like a ghost text autocomplete
    system_instruction = (
        "You are an expert real-time inline text autocompletion engine, similar to GitHub Copilot.\n"
        "Your task is to provide the natural, logical, and immediate completion of the text provided by the user.\n"
        "Follow these rules strictly:\n"
        "1. Output ONLY the raw character suffix that should be appended to the user's input to complete it.\n"
        "2. DO NOT repeat the user's input text.\n"
        "3. DO NOT include conversational intro or explanation (e.g. do not say 'Sure, here is the completion:').\n"
        "4. DO NOT wrap the response in markdown code blocks, quotes, or formatting unless it is part of the text continuation.\n"
        "5. You can suggest up to 100 words (or several sentences) to complete the user's thought.\n"
        "6. CRITICAL: Only suggest as many words as you are VERY CONFIDENT the user will actually use. Do not generate speculative or generic sentences. Start strong and stop generating as soon as your confidence or predictability decreases. If you are only confident in 3 words, return exactly 3 words. If you are confident in a whole paragraph, return the paragraph.\n"
        "7. If the user's text ends mid-word, complete that word first.\n"
        "8. If no logical continuation or completion exists, return absolutely nothing (an empty string)."
    )

    if request.chat_context and request.chat_context.strip():
        system_instruction += (
            f"\n\nCRITICAL CONTEXT FOR THIS DOCUMENT:\n"
            f"The user has defined the following structure or context for the document:\n"
            f"\"\"\"\n{request.chat_context.strip()}\n\"\"\"\n"
            f"Ensure your autocomplete suggestion strictly aligns with this structure, tone, and content goal."
        )

    try:
        logger.info(f"Generating completion using {model_to_use} for prompt length: {len(text)}")
        
        response = client.models.generate_content(
            model=model_to_use,
            contents=text,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,  # Low temperature for highly deterministic completions
                max_output_tokens=150,  # Support longer suggestions up to 100 words
            )
        )
        
        completion_text = response.text or ""
        
        # Clean up any potential markdown backticks if the model slipped up
        if completion_text.startswith("```") and completion_text.endswith("```"):
            lines = completion_text.splitlines()
            if len(lines) > 2:
                completion_text = "\n".join(lines[1:-1])
        
        return CompleteResponse(completion=completion_text)
        
    except Exception as e:
        logger.error(f"Error calling Gemini API: {e}")
        # Graceful fallback to gemini-2.5-flash if user is using flash-lite and it hits an issue
        if "3.1-flash-lite" in model_to_use:
            fallback_model = "gemini-2.5-flash"
            logger.info(f"Attempting fallback to {fallback_model}...")
            try:
                response = client.models.generate_content(
                    model=fallback_model,
                    contents=text,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.1,
                        max_output_tokens=150,
                    )
                )
                return CompleteResponse(completion=response.text or "")
            except Exception as fe:
                logger.error(f"Fallback model failed: {fe}")
        
        raise HTTPException(
            status_code=500,
            detail=f"Error generating autocomplete: {str(e)}"
        )


@app.post("/api/chat", response_model=AssistantResponse)
async def chat_assistant(request: ChatRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="Gemini API Client is not configured. Please check your GEMINI_API_KEY."
        )

    model_to_use = request.model or default_model_name
    logger.info(f"Processing chat request using model {model_to_use}")

    system_instruction = (
        "You are Aura Write Assistant, an expert writing companion and editor.\n"
        "Your task is to help the user write, format, restructure, outline, or expand their text.\n"
        "You communicate via a conversational chat interface, can update the text editor, and can also maintain "
        "and update a structural metadata context ('what this document is about / its structure') that guides "
        "real-time autocompletions.\n\n"
        
        "Your response MUST strictly conform to the JSON schema provided:\n"
        "1. `chat_response`: A friendly, concise conversational response. Reply conversationally, "
        "explain what changes you made, brainstorm with the user, or answer questions.\n"
        "2. `updated_text`: The COMPLETE, newly updated contents of the text editor. Follow these rules:\n"
        "   - If the user asks you to write, edit, format, or restructure text, you MUST output the entire updated document text in this field.\n"
        "   - The user is often just brainstorming or asking general questions, in which case you DO NOT have to update the editor. "
        "If no changes to the text are required, leave `updated_text` as null or omit it.\n"
        "   - DO NOT wrap `updated_text` in markdown code blocks. Output raw text exactly as it should appear in the editor.\n"
        "3. `updated_context`: The updated structure, outline, style, or about context of the document. Follow these rules:\n"
        "   - If the user explains the document's structure, outline, or what the document is about, or if you infer a specific "
        "structure or purpose from the user's request and text, you MUST output a concise structural description in this field.\n"
        "   - If the current structure/context doesn't change, or if the user is just chatting/brainstorming without affecting the document's "
        "overall structure or about, you MUST leave `updated_context` as null or omit it. This is critical for token efficiency.\n\n"
        
        "CRITICAL BEHAVIOR NOTE: Obviously, you do not have to answer every chat prompt with a change to the text editor. "
        "Sometimes the user is just brainstorming or asking a question. Use your judgment to only modify the text or the structure context "
        "when requested or highly appropriate."
    )

    # Construct the contextual chat prompt
    prompt_elements = []
    
    # 1. State the current document context
    prompt_elements.append("=== CURRENT DOCUMENT TEXT IN EDITOR ===\n")
    prompt_elements.append(request.current_text if request.current_text.strip() else "(The editor is currently empty.)")
    prompt_elements.append("\n========================================\n\n")

    # 2. Add current structure/context
    prompt_elements.append("=== CURRENT DOCUMENT STRUCTURE & ABOUT CONTEXT ===\n")
    prompt_elements.append(request.chat_context if request.chat_context and request.chat_context.strip() else "(No structure/context defined yet.)")
    prompt_elements.append("\n==================================================\n\n")

    # 3. Add history context
    if request.history:
        prompt_elements.append("=== CHAT HISTORY ===\n")
        for msg in request.history:
            role_label = "User" if msg.role == "user" else "Assistant"
            prompt_elements.append(f"{role_label}: {msg.content}\n")
        prompt_elements.append("====================\n\n")

    # 4. Add latest user request
    prompt_elements.append(f"User's Latest Request: {request.message}\n")
    prompt_elements.append("Please generate your response matching the required schema.")

    full_prompt = "".join(prompt_elements)

    try:
        # Call Gemini using Structured JSON output schema mapped to Pydantic AssistantResponse
        response = client.models.generate_content(
            model=model_to_use,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=AssistantResponse,
                temperature=0.7,
            )
        )
        
        # Parse the structured JSON response
        result_text = response.text or "{}"
        logger.info(f"Received structured chat response: {result_text[:200]}...")
        
        # Return the parsed response directly, FastAPI handles Pydantic model serialization
        return AssistantResponse.model_validate_json(result_text)

    except Exception as e:
        logger.error(f"Error in chat assistant API: {e}")
        # Try a quick fallback to gemini-2.5-flash if using flash-lite
        if "3.1-flash-lite" in model_to_use:
            fallback_model = "gemini-2.5-flash"
            logger.info(f"Attempting chat fallback to {fallback_model}...")
            try:
                response = client.models.generate_content(
                    model=fallback_model,
                    contents=full_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=AssistantResponse,
                        temperature=0.7,
                    )
                )
                return AssistantResponse.model_validate_json(response.text or "{}")
            except Exception as fe:
                logger.error(f"Fallback model failed: {fe}")

        raise HTTPException(
            status_code=500,
            detail=f"Error processing assistant response: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    # Bind to 0.0.0.0 for WiFi visibility
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)
