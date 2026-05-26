from typing import List, Optional
from pydantic import BaseModel, Field

# --- Autocomplete Schemas ---
class CompleteRequest(BaseModel):
    text_before_cursor: str
    text_after_cursor: Optional[str] = None
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

class EditBlock(BaseModel):
    start_line: int = Field(description="The 1-indexed line number where the edit block starts (inclusive).")
    end_line: int = Field(description="The 1-indexed line number where the edit block ends (inclusive).")
    replacement_content: str = Field(description="The replacement text for this line range. Can be empty string to delete lines.")

class AssistantResponse(BaseModel):
    chat_response: str = Field(
        description="A friendly, helpful, and concise conversational response to the user. "
                    "Briefly explain what changes or additions were made to the document (if any)."
    )
    edits: Optional[List[EditBlock]] = Field(
        None,
        description="A list of block-level changes to apply to the text editor. "
                    "Only include the blocks that actually need modification. "
                    "If no document changes are necessary or requested (e.g., general brainstorming), "
                    "leave this field as null or omit it."
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
