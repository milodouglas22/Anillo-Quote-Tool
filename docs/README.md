# Arcline App Framework

Reference documentation and pattern guides for building Arcline applications. These files are designed to be dropped into Claude conversations to guide implementation of specific features, patterns, and infrastructure.

> **Starting a new app?** Use the [arcline-app-template](https://github.com/Arcline-Investment-Management/arcline-app-template) repo as your starting point. Come back here when you need to implement a specific pattern.

---

## How to Use This Repo

1. **Find the guide** for what you're trying to build (see tables below)
2. **Drop the `.md` file into a Claude conversation** alongside your application code
3. **Claude will implement the pattern** following Arcline standards

---

## Standards

These define the baseline architecture and conventions for all Arcline apps.

### Standards Checklist

#### 1. Architecture (Required)
Read **[React-FastAPI-Architecture.md](React-FastAPI-Architecture.md)** and verify:
- [ ] Folder structure matches the standard
- [ ] Frontend uses Vite + React (not Create React App)
- [ ] Backend uses FastAPI (not Flask)
- [ ] Environment variables are properly configured

#### 2. UI/UX Design (Required)
Read **[UX-Design.md](UX-Design.md)** and verify:
- [ ] Tailwind CSS v4 is installed (not v3)
- [ ] Color palette uses Arcline brand colors
- [ ] Font is Inter
- [ ] Dark mode is implemented with next-themes pattern
- [ ] Arcline logo in header (switches for light/dark mode)

#### 3. Python Dependencies (Required)
Read **[Python-Packages.md](Python-Packages.md)** and verify:
- [ ] All standard packages are installed
- [ ] Versions are pinned correctly
- [ ] No conflicting or outdated packages

#### 4. API Patterns (Required)
Read **[API-Architecture.md](API-Architecture.md)** and verify:
- [ ] Routers follow the standard pattern
- [ ] Pydantic models are used for request/response
- [ ] Error handling follows conventions

#### 5. Authentication (If Applicable)
Read **[MSAL-Authentication.md](MSAL-Authentication.md)** and verify:
- [ ] MSAL is configured correctly
- [ ] useAuth hook exists and works
- [ ] Backend validates JWT tokens
- [ ] Access denied flow is implemented (if using group restrictions)

---

## Feature Patterns

Drop these into Claude when you need to implement a specific capability.

| Pattern | Guide | Description |
|:--------|:------|:------------|
| File upload with progress | [File-Upload-Progress-Pattern.md](File-Upload-Progress-Pattern.md) | XHR upload with progress tracking UI |
| File retention & cleanup | [File-Retention-Pattern.md](File-Retention-Pattern.md) | File naming, user directories, TTL cleanup |
| Column mapping for imports | [Column-Mapping-Pattern.md](Column-Mapping-Pattern.md) | Drag-and-drop column mapping workflow |
| Excel output formatting | [Excel-Output-Formatting-Pattern.md](Excel-Output-Formatting-Pattern.md) | Century Gothic font, hidden gridlines |
| Entity mapping across systems | [Entity-Mapping-Pattern.md](Entity-Mapping-Pattern.md) | Cross-system entity mapping to arclake hierarchy |
| Web scraping with progress | [Web-Scraping-Pattern.md](Web-Scraping-Pattern.md) | Web scraping with background processing and progress |
| Optimistic UI updates | [Optimistic-Operations-Guide.md](Optimistic-Operations-Guide.md) | TanStack Query optimistic mutations with rollback |

---

## Infrastructure & Security Guides

| Topic | Guide | Description |
|:------|:------|:------------|
| Fabric Data Warehouse | [Fabric-Setup-Guide.md](Fabric-Setup-Guide.md) | SQL tables, views, stored procedures, GraphQL via DAB |
| Box.com integration | [Box-Setup-Guide.md](Box-Setup-Guide.md) | Box API setup with JWT auth for file storage |
| Role-based security | [Role-Based-Security-Guide.md](Role-Based-Security-Guide.md) | Coarse-grain (module) and fine-grain (row-level) security with Azure AD groups |
| Embedded app integration | [embedded-app-integration-guide.md](embedded-app-integration-guide.md) | Embedding apps in the Arcline App Store via iframe with token relay |

---

## Deployment

| Target | Guide | Description |
|:-------|:------|:------------|
| Local executable (.exe) | [Local-Executable-Deployment-Guide.md](Local-Executable-Deployment-Guide.md) | PyInstaller packaging with MSAL auth bypass for offline distribution |

---

## Branding Assets

The `assets/` folder contains Arcline branding:

```
assets/
├── Arcline-Logo-Black.svg    # Logo for light mode
├── Arcline-Logo-White.svg    # Logo for dark mode
└── favicon.svg               # SVG favicon
```

---

## Technology Stack

### Frontend
- React 19 with Vite
- Tailwind CSS v4 (with @tailwindcss/vite plugin)
- shadcn/ui components (Radix UI + CVA)
- MSAL React for authentication
- Lucide React for icons

### Backend
- FastAPI with Uvicorn
- Pydantic for validation
- PyJWT for token validation
- Pandas, openpyxl, xlsxwriter for data processing

---

## Development Credentials

For local development, use the shared Arcline Development App Registration:

```
Client ID:     d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936
Tenant ID:     ecb62b6d-1041-494a-8b76-7fa15aa9a737
Redirect URI:  http://localhost:3000
```

**Important:** Frontend must run on port 3000 or 5173 (only registered redirect URIs).

---

## License

Internal use only - Arcline Investment Management
