# ResearchMate

ResearchMate (shown as **paperwise** in the dashboard) lets users upload PDFs, view their pages, add sticky notes, read page-by-page summaries, and ask questions about indexed content.

This branch combines the React frontend with the backend modules from `merged`. It retains the separate whole-paper placeholder summary method and adds paced page processing and automatic dashboard summary refresh.

## How it works

1. **Authentication:** Supabase Auth provides access tokens. The frontend sends the token with protected API requests.
2. **Upload:** FastAPI saves the original PDF locally and in Supabase Storage, converts it to PNG pages using Poppler, and records the pages in PostgreSQL.
3. **Page summaries:** A worker starts with FastAPI. It selects pages marked `empty`, downloads each image from Supabase, and calls Gemini. Results are saved in `pdf_pages.summary`.
4. **Indexing:** After saving a successful summary, the worker embeds the page image using ColQwen2 and stores the vector and summary in Qdrant.
5. **Dashboard refresh:** The frontend fetches `/pdf/{id}/pages` every three seconds while any page is pending. Completed summaries appear without reloading the browser. Polling stops when all pages finish or fail, or the selected paper changes.
6. **Chat:** `/chat` retrieves relevant page summaries from Qdrant and uses a Groq-hosted Llama model to answer with page references.

**Gemini and Groq have separate roles:** Gemini generates page summaries; Groq generates chat answers. A Gemini key alone is sufficient for page summaries, but not for the full chat workflow.

## Repository layout

| Path | Purpose |
| --- | --- |
| `frontend/` | React application used by these instructions |
| `backend/main.py` | FastAPI routes and background-worker lifecycle |
| `backend/db.py` | Shared database engine, session factory, and declarative base |
| `backend/models.py` | PDF, page, summary, and sticky-note database models |
| `backend/worker.py` | Page processing, pacing, and indexing |
| `backend/summarize.py` | Gemini image summarization and API retries |
| `backend/embeddings.py` | ColQwen2 embeddings and Qdrant storage/search |
| `backend/agent.py` | Retrieval and chat-answer pipeline |
| `backend/llm_client.py` | Groq client and chat-model configuration |
| `my-app/` | Separate Vite project; not the frontend used here |

## Prerequisites

- Python 3.10 or later, with a version supported by the installed ML packages.
- Node.js and npm compatible with React Scripts 5.
- PostgreSQL, or a Supabase PostgreSQL database.
- A Supabase project with Auth enabled and Storage buckets named **`pdfs`** and **`pdf-pages`**.
- Poppler for PDF-to-image conversion.
- A Gemini API key for real page summaries.
- A Groq API key for chat answers.
- Internet access and sufficient disk space for Python dependencies and embedding-model weights.

The backend creates missing SQLAlchemy tables on startup. This is not a migration system: it does not update existing table structures automatically.

### Poppler on Windows

The current code uses this explicit location in `backend/main.py`:

```text
C:\Program Files (x86)\poppler-25.12.0\Library\bin
```

Install Poppler there, or adjust `poppler_path` in `convert_pdf_to_pages()` to your installation. On another operating system, install Poppler on the system PATH and remove the Windows-specific argument.

## Backend configuration

Create `backend/.env` locally:

```dotenv
DATABASE_URL=postgresql+psycopg2://DB_USER:DB_PASSWORD@DB_HOST:5432/DB_NAME
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY=YOUR_GEMINI_API_KEY

# Needed for chat, not page summaries:
GROQ_API_KEY=YOUR_GROQ_API_KEY

# Optional; defaults shown:
SUMMARY_REQUEST_INTERVAL_SECONDS=15
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_CHAT_MODEL=llama-3.3-70b-versatile

# Optional remote Qdrant; set BOTH values to use it:
# QDRANT_URL=https://YOUR_QDRANT_HOST
# QDRANT_API_KEY=YOUR_QDRANT_API_KEY
```

Use your database provider's connection string and SSL options when applicable. URL-encode special characters in database credentials.

Keep `.env` and service-role/API keys out of Git. The service-role key belongs only on the backend. The README values above are placeholders; do not commit real credentials.

Without both Qdrant settings, the backend uses local storage at `backend/qdrant_db/` when launched from `backend/`.

The page-summary model is currently `gemini-3-flash-preview`, specified in `backend/summarize.py`. Model access and API quotas depend on your Google project.

## Run locally

Use two terminals. The commands below start from the repository root and use PowerShell on Windows.

### Terminal 1: backend

Create a virtual environment and install dependencies:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create the `.env` file described above, then start FastAPI:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Keep the working directory as `backend/`: file storage and local Qdrant paths are relative to it.

API documentation: <http://127.0.0.1:8000/docs>

On macOS/Linux, use `.venv/bin/python` instead of `.\.venv\Scripts\python.exe`, after adjusting the Poppler configuration.

### Terminal 2: frontend

```powershell
cd frontend
npm ci
npm start
```

Open <http://localhost:3000>. Sign in or create an account, then upload a small PDF to verify the complete page-summary flow.

The frontend API addresses are currently hardcoded to port 8000. The backend permits frontend origins `http://localhost:3000` and `http://localhost:3001`; use these addresses rather than an arbitrary port or hostname.

For a production frontend build:

```powershell
npm run build
```

To stop either development server, press **Ctrl+C** in its terminal. Restart FastAPI after changing API keys or worker environment settings.

## Processing behavior

Page states currently share the `summary` text column:

| Value | Meaning |
| --- | --- |
| `empty` | Waiting for the worker |
| `processing` | A page has been claimed for processing |
| `failed` | Summarization failed after available retries |
| Other text | Generated page summary |

The worker processes **one page at a time**, then waits at least **15 seconds** before the next page. Set `SUMMARY_REQUEST_INTERVAL_SECONDS` to increase that delay for your quota.

Gemini requests have up to three application-level attempts. A `429` quota error waits 60 seconds before the second attempt and 120 seconds before the third. A `503` service error uses shorter exponential backoff. Daily quota exhaustion will not be resolved merely by spacing requests.

The worker selects existing `empty` pages across the database, not just the PDF open in the dashboard. Previously completed or failed pages are skipped. There is currently no upload-date cutoff.

### Separate placeholder method

`POST /summary/` accepts a PDF ID and creates a whole-paper summary using `run_summary_agent()`, which currently returns `PlaceHold Summary`. `GET /summary/{pdf_id}` retrieves it.

This placeholder is separate from Gemini's page summaries. The dashboard's section-summary panel reads page summaries from `/pdf/{id}/pages`, not the whole-paper placeholder endpoint.

## Main API routes

Protected routes require `Authorization: Bearer <access_token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create an account |
| POST | `/auth/login` | Sign in |
| GET | `/auth/me` | Current user profile |
| POST | `/pdf/upload` | Upload and convert a PDF |
| GET | `/pdf/my_pdfs` | List the user's PDFs, newest first |
| GET | `/pdf/{id}/pages` | Page metadata, numbers, and summaries |
| GET | `/pdf/{id}/pages/{page_number}` | Page image |
| GET | `/pdf/{id}/download` | Original PDF from local storage |
| POST | `/chat` | Ask questions using indexed page content |
| POST / GET | `/summary/`, `/summary/{pdf_id}` | Create/read the whole-paper placeholder |
| POST | `/notes/` | Create a sticky note |
| GET | `/notes/{pdf_id}` | List notes for a PDF |
| PATCH / DELETE | `/notes/{note_id}` | Update/delete a note |

## Troubleshooting and current limitations

- **Pages say `failed`:** read the FastAPI terminal's `generate_summary failed` or `Summarization error` message. `429` indicates a quota limit; `503` indicates service unavailability. Check the project's actual quotas in Google AI Studio. The key is not necessarily invalid.
- **Old failures remain after adding a key:** failed pages are not automatically retried. For a simple smoke test, upload a new small PDF. There is no retry endpoint yet.
- **Pages remain `processing`:** an interrupted worker can leave this state behind. There is currently no automatic recovery of interrupted work.
- **Summary exists but chat cannot find it:** summary saving and indexing are separate operations. Embedding failures are logged and are not automatically retried. First embedding use downloads ColQwen2 weights and can be slow, especially on CPU.
- **Chat reports a server failure:** check the backend logs, Groq key, embedding dependencies, and Qdrant availability. Gemini alone does not configure chat.
- **Image fails to load:** inspect the browser Network response for `/pdf/{id}/pages/{page_number}`. The page-list response must include `page_number`. Check authentication, local image paths, and any Supabase signed-URL redirect.
- **Upload conversion fails:** check the configured Poppler location and Supabase bucket access.
- **Account creation has no session:** signup assumes Supabase returns a session. Projects requiring email confirmation may need an adjusted signup flow or suitable development Auth settings.
- **Download fails after local files are removed:** the merged download route uses local storage and has no Supabase fallback.
- **Chat ownership scope:** requests with a PDF ID verify ownership, but chat without a PDF ID currently has no enforced user filter on shared Qdrant retrieval. Fix this before allowing shared multi-user chat over private documents.

Validation so far includes backend syntax/import and route/schema checks, plus isolated tests for polling, cancellation, worker pacing, and quota retries. These do not establish that every provider call or a clean installation works on every machine. Verify with a small upload and your own configured services.
