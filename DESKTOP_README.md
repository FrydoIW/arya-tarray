# Arya Tarray for Windows

## Development

Install dependencies with `npm ci`. Keep the existing local `backend/.env` and `frontend/.env.local` for development. Run `npm run desktop:dev` from the repository root to start Express, Next.js, and the Electron window together.

## Build and installer location

Run `npm run desktop:build` on Windows. The script builds the backend and Next.js standalone server, stages production runtime files locally, creates an NSIS installer, and copies **only the final `.exe` installer** to the current Windows user's Downloads known folder. It reads the Windows Downloads location from the user's shell folder setting, so a redirected Downloads folder is supported without hardcoding a username.

The default name is `AryaTarray-Setup-<version>.exe`. If that filename already exists, the new installer receives a numeric suffix, such as `AryaTarray-Setup-0.1.0-2.exe`; existing files are never overwritten. On successful publication, local staging and release directories under `.desktop-build/` are removed. If a build fails, staging is retained for diagnosis and cleared at the start of the next build. The build script never deletes files in Downloads.

## Runtime database configuration

The installer contains no `.env` file or database credentials. Before launching the installed app, place a `backend.env` file at the location shown by the startup error message, or set `ARYA_TARRAY_ENV_FILE` to an absolute path of an existing external environment file. This file needs the same `DATABASE_URL` and `JWT_SECRET` values used by the backend. Keep it readable only by the Windows account running Arya Tarray. The desktop app uses the existing MySQL database and does not create or migrate tables.

The installed app starts its own local backend and Next.js runtime on ports 4000 and 3000. Those ports must be available. Closing the Electron window stops its child processes. The installer creates desktop and Start Menu shortcuts.
