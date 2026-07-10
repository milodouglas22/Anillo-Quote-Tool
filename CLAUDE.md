# Arcline App Template

This is a React + FastAPI application template with Azure AD authentication.

## First-Time Setup (IMPORTANT)

**You MUST check if dependencies are installed when this project is opened:**

1. Check if `frontend/.env` exists
2. Check if `frontend/node_modules` exists
3. Check if `backend/.env` exists
4. Check if `backend/venv` exists

**If any are missing, immediately run the setup commands before doing anything else.**

### Step 1: Create .env files (if missing)

Copy the example environment files:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

### Step 2: Install dependencies (if missing)

#### Windows
```bash
cd frontend && npm install
cd ../backend && python -m venv venv && venv\Scripts\pip install -r requirements.txt
```

#### macOS/Linux
```bash
cd frontend && npm install
cd ../backend && python -m venv venv && venv/bin/pip install -r requirements.txt
```

## Running the App

**Backend** (port 8000):
```bash
cd backend
venv\Scripts\activate  # Windows
# source venv/bin/activate  # macOS/Linux
uvicorn app.main:app --reload
```

**Frontend** (port 3000):
```bash
cd frontend
npm run dev
```

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS v4, shadcn/ui, MSAL
- **Backend**: FastAPI, Pydantic, PyJWT
- **Auth**: Azure AD (Microsoft Entra ID)

## Key Files

- `frontend/src/App.jsx` - Main React component
- `frontend/src/hooks/useAuth.js` - Authentication hook
- `backend/app/main.py` - FastAPI entry point
- `backend/app/core/security.py` - JWT validation

## Environment Variables

`.env.example` files are included with Arcline dev credentials. Copy them to `.env` to use. Frontend must run on port **3000** or **5173**.

## Adding Features

See the `arcline-app-framework` documentation for patterns:
- File uploads with progress
- Column mapping for Excel files
- Formatted Excel exports
- Embedded app integration (iframe)
