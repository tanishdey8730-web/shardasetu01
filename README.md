# Sharda Setu

Accessible learning platform with a dedicated **Online Education** module powered by curated YouTube lessons for competitive exams.

## Features

- Live classes, notes sharing, offline access, chat & polls (static pages).
- **Online Education** section (new) with:
  - A YouTube icon entry in the home page Features grid and Features page.
  - 10 competitive preparation exam tracks:
    `SSC`, `SSC CGL`, `SSC CHSL`, `SSC MTS`, `SSC GD`,
    `CDS`, `AFCAT`, `NDA`, `CAPF AC`, `RRB NTPC`.
  - Subject-wise videos for **Maths, Physics, Chemistry**.
  - YouTube **playlists** per exam, embedded inline.
- Small Node/Express backend that serves the course data via a JSON API
  and also serves the static frontend.

## Quick start

```bash
npm install
npm start
```

Open <http://localhost:3000/online-education.html> (or `index.html`).

If you don't want to run the backend, you can still open the HTML files
directly — the page falls back to `backend/data/education-fallback.js`.

## Progressive Web App (PWA)

Sharda Setu is installable as a PWA with offline caching, background sync, and push notifications.

- **Install**: Use the in-app banner or browser “Install app” (Chrome/Edge/Android).
- **Offline**: Core pages & assets cached; API calls queue when offline and sync on reconnect.
- **Push**: Set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in `.env` (generate via `npx web-push generate-vapid-keys`), sign in, allow notifications.
- **Service worker**: `service-worker.js` at site root (respects `SHARDA_BASE` on GitHub Pages).

```bash
npm run inject:pwa   # add PWA tags to all HTML pages (if missing)
```

| File | Role |
| ---- | ---- |
| `manifest.webmanifest` | App manifest (install, icons, shortcuts) |
| `service-worker.js` | Precache, runtime cache, push, background sync |
| `pwa.js` | Registration, install UI, sync queue, mobile nav |

## Real-time (Socket.io)

Live classes with **Socket.io**: live chat (sent / delivered / read status), polls, presence indicators, class stream updates, and personal notifications.

| Page | Description |
| ---- | ----------- |
| `/live-rooms.html` | Browse & join live classes |
| `/live-room.html?room=ID` | Live session UI |

REST: `GET /api/live/rooms`, `GET /api/live/rooms/:id`, `POST /api/live/rooms` (teacher/admin).

Socket events (JWT in `auth.token`): `room:join`, `chat:send`, `poll:create`, `poll:vote`, `class:update`, `presence:set`, `notification`.

## Cloudinary file storage

Secure cloud uploads via [Cloudinary](https://cloudinary.com) for **images**, **PDFs**, and **certificates**. Files use **authenticated** access with **signed URLs** (1-hour expiry). Profile avatars upload to Cloudinary when configured.

1. Copy `.env.example` → `.env` and set:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
2. `npm install` (includes `cloudinary` package)
3. Open **File Manager** at `/file-manager.html`

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/cloud-files/status` | Cloudinary config status |
| GET | `/api/cloud-files` | List your files (`?category=pdf`) |
| POST | `/api/cloud-files/upload` | Multipart: `file`, `category` (`image` \| `pdf` \| `certificate`), optional `title` |
| GET | `/api/cloud-files/:id` | File metadata + signed URL |
| DELETE | `/api/cloud-files/:id` | Delete (owner or admin) |

Admins can list all files with `?all=true` or filter `?userId=`.

## Authentication

Production-style auth with **bcrypt**, **JWT** (access + refresh tokens), **email verification**, **password reset**, and **Google OAuth**. Roles: `student`, `teacher`, `admin`.

| Method | Path | Description |
| ------ | ---- | ------------- |
| POST | `/api/auth/register` | `{ name, email, password, role? }` |
| POST | `/api/auth/login` | `{ email, password }` → `{ user, token, refreshToken }` |
| POST | `/api/auth/logout` | `{ refreshToken }` + Bearer token |
| POST | `/api/auth/refresh` | `{ refreshToken }` → new token pair |
| POST | `/api/auth/forgot-password` | `{ email }` |
| POST | `/api/auth/reset-password` | `{ token, password }` |
| GET | `/api/auth/verify-email?token=` | Verify email |
| POST | `/api/auth/resend-verification` | `{ email }` |
| GET | `/api/auth/google` | Redirect to Google OAuth |
| GET | `/api/auth/status` | JWT / OAuth / SMTP configured |

Pages: `login.html`, `signup.html`, `forgot-password.html`, `reset-password.html`, `verify-email.html`, `auth-callback.html`, `admin.html` (admin only).

Copy `.env.example` → `.env` and set `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and optionally Google + SMTP. Without SMTP, verification/reset links are printed to the server console in development.

## Teacher Dashboard

Open **Teacher Dashboard** at `/teacher-dashboard.html` (requires `teacher` or `admin` role).

| Feature | Description |
| ------- | ----------- |
| Upload lessons | YouTube link, metadata, optional file; optional admin approval |
| Upload notes | Text + PDF; optional admin approval |
| Create quizzes | Build MCQs and publish to platform question bank |
| Assignments | Create, view submissions, grade with feedback |
| Student performance | Mock/quiz/assignment stats per student |
| Discussions | Moderate threads (pin, hide, flag, delete) |
| Course analytics | Views, downloads, content breakdown by exam |

| Method | Path |
| ------ | ---- |
| GET | `/api/teacher/dashboard` |
| POST | `/api/teacher/lessons` (multipart) |
| POST | `/api/teacher/notes` (multipart) |
| POST | `/api/teacher/quizzes` |
| POST | `/api/teacher/quizzes/:id/publish` |
| GET/POST | `/api/teacher/assignments` |
| GET | `/api/teacher/assignments/:id/submissions` |
| PATCH | `/api/teacher/submissions/:id` (grade) |
| GET | `/api/teacher/performance` |
| GET | `/api/teacher/analytics` |
| GET/PATCH | `/api/teacher/discussions` |

Students: `GET /api/assignments`, `POST /api/assignments/:id/submit`, `GET/POST /api/discussions`.

Set a user's `"role": "teacher"` in `backend/data/users.json` or sign up as Teacher on the registration page.

## Admin Dashboard

Open **Admin Dashboard** at `/admin-dashboard.html` (requires `admin` role).

Manage users (role, disable), courses, videos, AI notes & summaries, content approvals, platform analytics, and downloadable JSON reports. Teachers can submit content via `POST /api/content/submit`.

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/admin/dashboard` | Stats + activity chart data |
| GET | `/api/admin/users` | List/search users |
| PATCH | `/api/admin/users/:id` | Update role / disabled |
| GET/POST | `/api/admin/courses` | List / add courses |
| GET/POST | `/api/admin/videos` | List / add videos |
| GET/DELETE | `/api/admin/notes` | List / delete notes |
| GET | `/api/admin/approvals` | Approval queue |
| POST | `/api/admin/approvals/:id/approve` | Approve content |
| POST | `/api/admin/approvals/:id/reject` | Reject content |
| GET | `/api/admin/analytics` | Platform analytics |
| GET | `/api/admin/reports?type=` | summary, users, content |

To create an admin: set `ADMIN_REGISTRATION_SECRET` in `.env` and register with that secret, or manually set `"role": "admin"` in `backend/data/users.json`.

## Student Profile

Open **My Profile** at `/profile.html` (sign-in required).

Tabs: overview, editable profile, test history, certificates, saved courses, achievements, progress report (Chart.js + readiness). Upload a profile photo (max 2 MB).

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/student-profile` | Full profile payload |
| PUT | `/api/profile/me` | Update name, bio, exam goal, etc. |
| POST | `/api/profile/avatar` | Multipart `avatar` image upload |
| POST | `/api/profile/saved-courses` | `{ courseId, title, url?, examId? }` |
| DELETE | `/api/profile/saved-courses/:courseId` | Remove saved course |

## Gamification

Integrated into the **Student Dashboard** (`/student-dashboard.html`).

- XP, 10 levels, badges, achievements
- Daily & weekly challenges with claimable rewards
- All-time and weekly leaderboards with user ranking
- Toast notifications for XP, level-ups, and badges
- Auto XP on quiz, mock test, notes, and daily login

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/gamification` | Full profile (XP, badges, challenges, leaderboard) |
| GET | `/api/gamification/leaderboard?period=weekly` | Leaderboard only |
| POST | `/api/gamification/challenges/claim` | Claim challenge `{ challengeId, period }` |
| POST | `/api/gamification/notifications/read` | Mark notifications read |

## Student Dashboard

Open **Dashboard** at `/student-dashboard.html` (sign-in required).

Aggregates mock tests, quizzes, notes, roadmap, and assistant activity into one view: streak, study hours, modules completed, readiness score, goals, charts, and recommendations.

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/dashboard` | Full dashboard payload |
| POST | `/api/dashboard/goals` | Add custom goal `{ title, dueDate }` |
| PATCH | `/api/dashboard/goals/:goalId` | Mark goal complete `{ completed }` |

## AI Notes Generator

Open **Notes Generator** at `/notes-generator.html` (sign-in required).

| Method | Path | Description |
| ------ | ---- | ------------- |
| POST | `/api/generate-notes` | JSON `{ youtubeUrl, examFocus, noteType }` or multipart `pdf` file |
| GET | `/api/notes` | List your generated notes |
| GET | `/api/notes/:id` | Get one note |
| GET | `/api/notes/:id/export/pdf` | Download PDF |
| GET | `/api/notes/:id/export/docx` | Download Word document |

Requires `OPENAI_API_KEY` or `GEMINI_API_KEY`. YouTube uses captions when available; PDFs must be text-based (under 8 MB).

## YouTube Video Summarizer

Open **Video Summarizer** at `/video-summarizer.html` (sign-in required).

Paste a YouTube URL to fetch captions, then AI generates: summary, key points, concepts, formulas, 5 practice MCQs, and revision notes. Export the full summary as PDF.

| Method | Path | Description |
| ------ | ---- | ------------- |
| POST | `/api/summarize-video` | `{ youtubeUrl, examFocus }` |
| GET | `/api/summaries` | List your summaries |
| GET | `/api/summaries/:id` | Get one summary |
| GET | `/api/summaries/:id/export/pdf` | Download PDF |

Requires `OPENAI_API_KEY` or `GEMINI_API_KEY`. Works best with videos that have English or Hindi captions.

## AI Rank Prediction

Open **Rank AI** at `/rank-prediction.html` (sign-in required).

Analyzes mock test performance to predict estimated rank, qualifying/selection probability, future score trends (linear projection), and ranked improvement suggestions. Supports SSC CGL, SSC, NDA, CDS, AFCAT, and RRB NTPC cohort models.

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/rank-prediction` | Full prediction (`?examId=ssc-cgl`) |

## Exam Readiness Score

Open **Readiness** at `/exam-readiness.html` (sign-in required).

Full readiness system: weighted overall score, subject-wise performance bars, weakness analysis (severity + impact), prioritized recommendation engine, component progress indicators, and daily historical tracking.

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/exam-readiness` | Full report (`?examId=ssc-cgl` optional) |
| GET | `/api/exam-readiness/history` | Score history only |

## Performance Analytics

Open **Analytics** at `/performance-analytics.html` (sign-in required).

Analyzes mock test results: weak/strong topics, readiness score (0–100), exam success probability, Chart.js dashboards, and AI tips when API keys are set.

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/analytics` | Full dashboard data (`?examId=ssc-cgl` optional) |
| GET | `/api/readiness-score` | Readiness, probability, top recommendations |

## Advanced Analytics Dashboard

Open **Analytics+** at `/analytics-dashboard.html` (sign-in required). Admins also see platform user-growth and activity charts.

Charts (Recharts): daily study hours, weekly progress, subject-wise performance, personal/platform growth, exam readiness trend. Filters: date range, exam, subject.

Build the frontend bundle once after `npm install`:

```bash
npm run build:analytics
```

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/analytics/advanced` | Full dashboard (`?range=30d&examId=&subjectId=`) |
| GET | `/api/analytics/platform` | Admin platform metrics (`?range=30d`) |

## AI Question Generator

Open **Question Generator** at `/question-generator.html` (sign-in required).

Generate topic-wise questions: **MCQ**, **subjective**, or **PYQ-style**. Choose **Easy**, **Medium**, or **Hard**. Response includes questions, instant **answer key**, and **explanations** (toggle in UI).

| Method | Path | Description |
| ------ | ---- | ------------- |
| POST | `/api/question-generator` | `{ topic, examId?, subject?, questionType, difficulty, count? }` |
| GET | `/api/question-generator` | List your recent sets |
| GET | `/api/question-generator/:setId` | Load one set |
| GET | `/api/question-generator/status` | AI configured? |

`questionType`: `mcq` | `subjective` | `pyq` · `difficulty`: `easy` | `medium` | `hard` · `count`: 1–20 (default 5)

Requires `OPENAI_API_KEY` or `GEMINI_API_KEY`.

## Online Examination & Mock Tests

Open **Mock Tests** at `/mock-tests.html` (sign-in required to attempt).

- Chapter-wise tests, full-length mocks, PYQ sets
- Timer, question palette, negative marking, auto evaluation
- Result dashboard with question-wise review
- Question bank: `GET/POST /api/question-bank` (246+ questions; rebuild with `node backend/build-question-bank.js`)

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/exam-catalog` | List mocks, chapters, PYQ |
| POST | `/api/tests` | Start a test session |
| GET | `/api/tests/:testId` | Resume session |
| POST | `/api/submit-test` | Submit answers (`testId`, `answers`, `timeTakenSeconds`) |
| GET | `/api/results` | User result history + summary |
| GET | `/api/results/:resultId` | Full breakdown with solutions |

## Personalized Learning Roadmap

Open **My Roadmap** at `/learning-roadmap.html` (sign-in required).

- Select exam (SSC, NDA, CDS, AFCAT, RRB, etc.) and exam date
- AI-assisted tips when API keys are configured; core schedule is algorithmically generated
- Day-wise tasks, weekly targets, progress %, topic checkboxes
- Missed tasks auto-reschedule on each `GET /api/roadmap/:userId`

| Method | Path | Description |
| ------ | ---- | ------------- |
| GET | `/api/roadmap/exams` | List supported exams |
| POST | `/api/roadmap` | Create or return roadmap (`examId`, `examDate`, `hoursPerDay`, `regenerate`) |
| GET | `/api/roadmap/:userId` | Get roadmap + auto-adjust schedule |
| PATCH | `/api/roadmap/:userId` | Mark topic complete (`topicId`, `date`, `completed`) |

Data: `backend/data/learning-roadmaps.json`

## AI Study Assistant

Open **Study Assistant** at `/study-assistant.html` or use the nav link.

1. Copy `.env.example` to `.env` and set **either** `OPENAI_API_KEY` or `GEMINI_API_KEY`.
2. Restart the server: `npm start`.

Features: exam-focused tutoring (SSC, NDA, CDS, AFCAT, RRB), markdown replies, typing indicator, voice input (browser), chat history stored in `backend/data/conversations.json`, dark mode, guest sessions or signed-in users.

## API

| Method | Path                                  | Description                          |
| ------ | ------------------------------------- | ------------------------------------ |
| GET    | `/api/health`                         | Health check                         |
| GET    | `/api/chat/status`                    | AI provider configuration status     |
| POST   | `/api/chat`                           | Send message; returns assistant reply  |
| GET    | `/api/chat/conversations`             | List conversations (auth or guest)     |
| GET    | `/api/chat/conversations/:id`         | Full message history for a chat      |
| DELETE | `/api/chat/conversations/:id`         | Delete a conversation                |
| GET    | `/api/online-education`               | Full education payload               |
| GET    | `/api/online-education/exams`         | Just the list of competitive exams   |
| GET    | `/api/online-education/exams/:id`     | Detail for a specific exam           |
| GET    | `/api/online-education/subjects`      | Subjects and cross-subject playlists |

### POST `/api/chat`

```json
{
  "message": "Explain SI and CI shortcuts for SSC",
  "conversationId": "optional-existing-id",
  "examFocus": "ssc",
  "guestSessionId": "only-if-not-signed-in"
}
```

Headers: `Authorization: Bearer <token>` when signed in, or `X-Guest-Session: <uuid>` for guests.

Exam ids: `ssc`, `ssc-cgl`, `ssc-chsl`, `ssc-mts`, `ssc-gd`,
`cds`, `afcat`, `nda`, `capf`, `rrb-ntpc`.

## File layout

```
.
├── index.html / about.html / features.html / login.html / signup.html
├── online-education.html      (exam tracks & videos)
├── study-assistant.html       (AI chat tutor)
├── study-assistant.css / study-assistant.js
├── online-education.css
├── online-education.js
├── style.css / features.css / about.css / login.css / signup.css
├── backend/
│   ├── server.js              (Express API + static server)
│   ├── chat.js                (Study Assistant AI + persistence)
│   └── data/
│       ├── conversations.json (chat history database)
│       ├── education.json     (source of truth)
│       └── education-fallback.js  (offline copy for file:// opens)
└── package.json
```

## Editing the catalog

Edit `backend/data/education.json` to add/replace videos and playlists.
Restart the server to pick up changes. If you also want the page to work
without the backend, mirror your edits into
`backend/data/education-fallback.js`.
