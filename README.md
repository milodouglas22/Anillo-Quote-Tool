# Arcline App Template

A ready-to-run skeleton application for building internal Arcline applications with React + FastAPI + Azure AD authentication.

## What's Included

- **Frontend**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui components
- **Backend**: FastAPI + Pydantic + Azure AD JWT validation
- **Authentication**: Microsoft Authentication Library (MSAL) with Azure AD
- **Dark Mode**: Built-in light/dark theme toggle
- **Branding**: Arcline logos and color scheme pre-configured

---

## For Claude: Initial Setup

When this template is copied to a new repository, run these commands to install dependencies:

### Windows

```bash
cd frontend && npm install && cd ../backend && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt
```

### macOS/Linux

```bash
cd frontend && npm install && cd ../backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

---

## Prerequisites

- **Node.js** 18+ (for frontend)
- **Python** 3.10+ (for backend)
- **npm** (comes with Node.js)

---

## Quick Start

### 1. Install Dependencies

**Frontend:**
```bash
cd frontend
npm install
```

**Backend:**
```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Start the Servers

**Backend** (Terminal 1):
```bash
cd backend
# Activate venv if not already active
uvicorn app.main:app --reload --port 8000
```

**Frontend** (Terminal 2):
```bash
cd frontend
npm run dev
```

### 3. Open the App

Navigate to **http://localhost:3000** and click "Sign in with Microsoft".

---

## Project Structure

```
arcline-app-template/
├── frontend/                 # React + Vite frontend
│   ├── public/               # Static assets (logos, favicon)
│   ├── src/
│   │   ├── components/       # UI components
│   │   │   ├── ui/           # shadcn/ui components
│   │   │   └── theme-provider.jsx
│   │   ├── config/           # Configuration (MSAL auth)
│   │   ├── hooks/            # Custom React hooks
│   │   ├── lib/              # Utilities
│   │   ├── App.jsx           # Main application
│   │   ├── main.jsx          # Entry point
│   │   └── index.css         # Tailwind + theme styles
│   ├── .env                  # Frontend environment variables
│   └── package.json
│
├── backend/                  # FastAPI backend
│   ├── app/
│   │   ├── core/             # Config and security
│   │   ├── models/           # Pydantic models
│   │   ├── routers/          # API routes
│   │   └── main.py           # FastAPI app
│   ├── uploads/              # File upload directory
│   ├── .env                  # Backend environment variables
│   └── requirements.txt
│
├── .gitignore
└── README.md
```

---

## Customization

### Change the App Name

1. Update `<title>` in `frontend/index.html`
2. Update the "App Name" text in `frontend/src/App.jsx` (appears in login card and header)
3. Update `title` in `backend/app/main.py`

### Add New Components

Use the shadcn/ui pattern. Create components in `frontend/src/components/ui/`.

### Add API Routes

Create new routers in `backend/app/routers/` and register them in `backend/app/main.py`.

### Restrict Access by Azure AD Group

Set the `ALLOWED_GROUPS` environment variable in `backend/.env`:

```env
ALLOWED_GROUPS=group-object-id-1,group-object-id-2
```

---

## Environment Variables

### Frontend (`frontend/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_AZURE_CLIENT_ID` | Azure AD App Registration Client ID |
| `VITE_AZURE_TENANT_ID` | Azure AD Tenant ID |
| `VITE_REDIRECT_URI` | OAuth redirect URI (must match Azure AD) |
| `VITE_API_BASE_URL` | Backend API URL |

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `AZURE_CLIENT_ID` | Azure AD App Registration Client ID |
| `AZURE_TENANT_ID` | Azure AD Tenant ID |
| `ALLOWED_GROUPS` | Comma-separated Azure AD Group IDs (optional) |
| `CORS_ORIGINS` | Allowed CORS origins |

---

## Development Credentials

This template comes with pre-configured development credentials for the Arcline dev tenant. The frontend must run on **port 3000** or **5173** (the only registered redirect URIs).

---

## Troubleshooting

### Port 3000 Already in Use

```bash
# Windows
for /f "tokens=5" %a in ('netstat -ano ^| findstr :3000') do taskkill /PID %a /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

### Authentication Fails

- Ensure frontend is running on port **3000** or **5173**
- Check `.env` files have correct credentials
- Clear browser localStorage and try again

### Module Not Found (Backend)

- Ensure all `__init__.py` files exist
- Verify virtual environment is activated
- Check import paths match folder structure

---

## Learn More

For detailed patterns and guides, see the [arcline-app-framework](../arcline-app-framework/) documentation:

- `MSAL-Authentication.md` - Azure AD authentication setup
- `API-Architecture.md` - REST API conventions
- `UX-Design.md` - Arcline brand colors and styling
- `File-Upload-Progress-Pattern.md` - File uploads with progress
- `Column-Mapping-Pattern.md` - Excel column mapping
- `Excel-Output-Formatting-Pattern.md` - Formatted Excel exports
