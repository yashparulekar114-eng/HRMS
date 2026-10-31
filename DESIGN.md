# DESIGN.md — Konkan People

> Status: draft for faculty sign-off · Author: Yash Parulekar · The images live in `docs/wireframes/`. Every wireframe uses illustrative data that `supabase/seed.sql` recreates exactly (see "Sample data" at the end).

**Design priority:** every business rule must be visible and usable on screen. A plain screen where every rule works beats a polished one that hides them.

## Product

- **Name:** Konkan People
- **Logo:** a simple coastal wave mark next to the wordmark, in pink on the black sidebar
- **Direction:** functional and calm. An employee can check in and see their leave balance on the dashboard without clicking anything else.

## Colour tokens

| Token | Hex | Use |
| --- | --- | --- |
| primary | `#0B0B14` (black) | Sidebar, headings |
| interactive | `#BE185D` (pink) | Buttons, active nav item (6.0:1 with white text) |
| accent | `#1D4ED8` (blue) | Links, focus ring, key figures (6.7:1 on white) |
| page | `#F8F6FB` | Page background |
| surface | `#FFFFFF` | Cards, tables |
| text | `#1E1B2E` | Body text (13.6:1 on page) |
| border | `#E4DFF0` | Dividers, inputs |

## Status tokens

These are used the same way in the attendance calendar, team view, HR dashboard and reports. Every text colour passes WCAG AA (4.5:1).

| Status | Background | Text / icon | Contrast | Label in cell |
| --- | --- | --- | --- | --- |
| Present | `#DCFCE7` | `#166534` | 6.5 | P (WFH adds a house icon; same hour thresholds as office) |
| Half Day | `#FEF3C7` | `#92400E` | 6.4 | H |
| Absent | `#FEE2E2` | `#991B1B` | 6.8 | A |
| On Leave | `#DBEAFE` | `#1E40AF` | 7.2 | Leave code (CL, SL, EL, ML, PL, OH, LOP) |
| Holiday | `#EDE9FE` | `#5B21B6` | 7.6 | Holiday name |
| Weekly Off | `#F1F5F9` | `#475569` | 6.9 | WO |
| Pending Regularisation | `#FCE7F3` with a dashed border | `#9D174D` | 6.7 | ? |
| Late (overlay) | Corner dot `#C2410C` | White "L" | 5.2 | L |

- **Late** is a marker shown on top of Present or Half Day, not a day status of its own.
- **Never colour alone:** every cell shows a letter, a code or an icon.
- **Half-day leave cells** are split diagonally between the leave colour and the attendance colour (e.g. 0.5 CL + 0.5 Present = blue / green).

## Typography and spacing

- **Font:** Inter, or Geist
- **Spacing:** an 8px grid
- **Strong colour** is reserved for statuses, warnings and the main action on each screen.

## Components

Button (primary, secondary, danger, loading), card, table (becomes cards on a phone), form field with error, status badge, calendar cell, confirmation dialog, empty state, toast.

## Navigation

Menu items appear only when the user's role allows them; the server and database still enforce permissions.

| Item | Who sees it |
| --- | --- |
| Dashboard | Everyone |
| Attendance | Everyone |
| My Leave | Everyone |
| Approvals | Managers, HR |
| Employees | HR |
| Reports | Managers (own team), HR |
| Ask HR | Everyone |
| Settings | HR |

- **On a phone**, a bottom bar shows Dashboard, Attendance, Leave and Ask HR.

## Dashboards by role

- **Employee:**
  - check-in card with the scheduled hours (10:00–19:00; Late from 10:16:00 IST)
  - leave balance cards
  - "Late marks this month: X of 3"
  - pending requests
  - a "You haven't checked out" banner when needed
- **Manager:** everything above, plus who in the team is present, on leave or absent today, and the number of pending approvals.
- **HR Admin:** month-end readiness (pending approvals and unresolved punches before the cutoff), plus workforce exceptions.

## Scope

- **Required:**
  - wireframes for all 13 suggested screens
  - phone layouts for Check-in, Apply leave and Ask HR
  - empty, loading and error states for the Dashboard, Approvals and Reports
  - the four user flows (see `design-flows.md`)
- **Deferred:** tablet-specific layouts, offline support, non-essential animation.

## Responsive layouts

- **Desktop:** a fixed sidebar. Ask HR opens as a side panel on the right, so the page behind stays usable.
- **Phone:** a bottom bar with Home, Attendance, Leave and Ask HR. Tables turn into stacked cards, and the main action is a full-width sticky button.
- **Required phone layouts:** Check-in, Apply leave and Ask HR (wireframes 03, 04 and 05).
- **Deferred:** tablet-specific layouts, offline support and non-essential animation.

## UI states

| Screen | Loading | Empty | Error |
| --- | --- | --- | --- |
| Dashboard | Skeleton cards, no layout jump | New joiner: "Check in to start your first day", with pro-rated balances | "We couldn't load your balances. Check-in still works." + Retry |
| Approvals | Skeleton rows | "Nothing waiting for you." | "You can't approve this: Sneha doesn't report to you." (403) |
| Reports | Skeleton table | "No attendance recorded for March 2026 yet." | "Couldn't build the October summary. Nothing was downloaded." + Retry |
| Reports: finalise | "Finalising October…" | — | "October is already finalised; corrections now appear as adjustments in November." |
| Any screen | — | — | Access denied: 403 page. Ended employment: "Your access ended on …" |

Error messages always say what happened and what to do next, never just "Request failed".

## User flows

### Flow 1. Add employee

```mermaid
flowchart TD
    A([HR Admin opens Employees → Add employee]) --> B{Server: is_hr_admin?}
    B -- No --> B1[403: Access denied page]
    B -- Yes --> C["Multi-step form<br/>1 Personal · 2 Job · 3 Statutory · 4 Bank · 5 Emergency"]
    C --> D{"Form validation (inline errors)<br/>PAN · Aadhaar 12 digits · UAN optional<br/>IFSC · mobile 6–9 + 9 digits · PIN 6 digits<br/>state from dropdown · age ≥ 18 on joining date"}
    D -- Invalid --> D1["Field shows a clear message<br/>e.g. 'PAN must be 5 letters, 4 digits, 1 letter'"] --> C
    D -- Valid --> E["Submit → hr_add_employee RPC<br/>(caller from JWT; HR re-checked in the function)"]
    E --> F{"Database checks<br/>CHECK regexes · dob ≤ doj − 18 years<br/>unique email · manager exists and is active"}
    F -- Fails --> F1[Readable error mapped to the field] --> C
    F -- Passes --> G["One transaction:<br/>employee_code from sequence (KCF0001…)<br/>employees + employee_sensitive + employee_emergency<br/>clerk_user_id left empty · audit_log entry"]
    G --> H(["Success: 'KCF0021 created'<br/>Aadhaar shown masked"])
    H -.-> I([Later: employee signs in with Clerk])
    I --> J{Middleware: clerk_user_id already linked?}
    J -- Yes --> L
    J -- No --> K{"Employee row with this verified email?"}
    K -- No --> K1[Access denied: not an employee]
    K -- Yes --> K2[Link: set clerk_user_id] --> L
    L{"Active? last_working_day empty<br/>or today in IST ≤ last_working_day"}
    L -- No --> L1[Access denied: employment ended]
    L -- Yes --> M([Dashboard for their role])
```

### Flow 2. Check-in to day status

```mermaid
flowchart TD
    A([Employee on Dashboard]) --> B["Clicks Check in<br/>(WFH toggle if working from home)"]
    B --> C["punch_clock RPC<br/>caller from JWT · time = server clock<br/>date = (now() AT TIME ZONE 'Asia/Kolkata')::date"]
    C --> D{Row for this employee + IST date exists?}
    D -- Yes --> D1[Return existing row: no second record]
    D -- No --> E["INSERT attendance (check_in, is_wfh)"]
    E --> F{"check-in at 10:16:00 IST or later?<br/>(up to 10:15:59 = grace; office and WFH alike)"}
    F -- Yes --> F1[Late marker on the day]
    F -- No --> G
    F1 --> G([Later: clicks Check out → check_out set once])
    D1 --> G
    G --> S["Day status worked out when it is read (no scheduled job)"]
    S --> P1{Inside an ML period?}
    P1 -- Yes --> R1[ML]
    P1 -- No --> P2{National / State holiday for their location?}
    P2 -- Yes --> R2[Holiday]
    P2 -- No --> P3{Weekly off for their location?<br/>Panaji: Sat + Sun · Verna: Sun}
    P3 -- Yes --> R3[Weekly Off]
    P3 -- No --> P4{Approved full-day leave?}
    P4 -- Yes --> R4["On Leave (even if punched)"]
    P4 -- No --> P5{Check-out missing?}
    P5 -- Yes --> P6{Regularisation rejected<br/>or month closed?}
    P6 -- Yes --> R6[Absent]
    P6 -- No --> R7[Pending Regularisation]
    P5 -- No --> P8{"Hours worked (same thresholds for WFH)<br/>(thresholds halve on a half-day leave day)"}
    P8 -- "≥ 8 h" --> R9["Present<br/>(WFH day → WFH column, house icon)"]
    P8 -- "4 to < 8 h" --> R10["Half Day: 0.5 Present (or WFH) + 0.5 Absent"]
    P8 -- "< 4 h" --> R6
    R9 & R10 --> L["Late marks this month (office and WFH) → floor(lates ÷ 3) × 0.5<br/>= Late_LOP column in the CSV"]
```

### Flow 3. Apply leave → approval → balance

```mermaid
flowchart TD
    A([Employee: Apply leave form<br/>or Confirm on an agent draft card]) --> B["Enter type, dates, reason<br/>half day: single date + First/Second half"]
    B --> C["Live preview via SQL functions<br/>count_working_days (location weekly offs + holidays excluded;<br/>ML in calendar days) + balance view"]
    C --> V{"Checks<br/>from ≥ today (IST) − 30 days<br/>no overlap (two half days on one date allowed if halves differ, total ≤ 1.0)<br/>half day allowed for this type"}
    V -- Fails --> V1["Clear message, e.g. 'Overlaps your pending request of 3 Nov'"] --> B
    V -- Passes --> SL{SL over 2 working days?}
    SL -- Yes --> SL1{Certificate uploaded?}
    SL1 -- No --> SL2[Submit disabled until uploaded] --> SL1
    SL1 -- Yes --> BAL
    SL -- No --> BAL{Available balance enough?}
    BAL -- Yes --> SUB
    BAL -- No --> LOP{"'Convert 1.5 days to LOP?'<br/>(explicit opt-in)"}
    LOP -- No --> B
    LOP -- Yes --> SUB["Submit → apply_leave RPC (accept_lop = true if chosen)<br/>EL: whole days only from balance; fraction stays"]
    SUB --> T["One transaction:<br/>lock applicant's employees row · recompute days and balance<br/>one line per date and type: paid first, by date, then LOP<br/>(a date may be 0.5 paid + 0.5 LOP; total ≤ 1.0)<br/>status = Pending"]
    T --> ML{Maternity leave?}
    ML -- Yes --> HRQ["Routed to HR, not the manager<br/>HR verifies eligibility and confirms 12 or 26 weeks"] --> INBOX
    ML -- No --> CM{Any date in a finalised payroll month?}
    CM -- Yes --> HRQ2[Routed to HR only] --> INBOX
    CM -- No --> M{Has a reporting manager?}
    M -- No --> AA["Auto-approved · note 'no reporting manager'"] --> USED
    M -- Yes --> EM[Server emails the manager after commit] --> INBOX
    INBOX["Approvals inbox:<br/>reporting manager or HR Admin"] --> CHK{"process_leave_request:<br/>approver is manager or HR · approver ≠ applicant<br/>request still Pending?"}
    CHK -- No --> X[403 with reason]
    CHK -- Yes --> DEC{Approve or reject, with comment}
    DEC -- Reject --> RJ[Rejected · pending released] --> EE
    DEC -- Approve --> AP[Approved · decided_at set] --> ADJ{Touches a finalised month?}
    ADJ -- Yes --> PA["Same transaction: one payroll_adjustment per affected date<br/>(difference from last payroll-accounted state)"] --> USED
    ADJ -- No --> USED
    USED["Balance is calculated, not stored:<br/>available = opening + accrued − used − pending<br/>used = approved day lines, minus dates now holidays"] --> EE[Server emails the employee]
    EE --> CN{Employee cancels?}
    CN -- "Pending, or approved and not started (IST)" --> CA[cancel_my_leave → Cancelled · balance back automatically]
    CN -- "Already started" --> CB[Blocked: HR can shorten it, audited]
```

### Flow 4. Missed punch → regularisation and corrections

```mermaid
flowchart TD
    A([Working day in the past]) --> B{Punches?}
    B -- "Check-in, no check-out" --> C[Day shows Pending Regularisation<br/>+ dashboard banner 'You have not checked out']
    B -- "No punch, no approved leave" --> C2["Day shows Absent<br/>(past working days only; future dates never Absent)"]
    C --> D
    C2 --> D["Employee opens My attendance → Regularise<br/>enters corrected in/out times + reason"]
    D --> E["request_regularisation RPC<br/>caller from JWT · requested_out > requested_in<br/>one Pending request per date"]
    E -- Fails --> E1[Clear message, e.g. 'A request for 21 Oct is already pending'] --> D
    E -- OK --> F["Status: Pending · attendance unchanged"]
    MR(["Manager raises a correction for a direct report<br/>(requested_by = manager)"]) --> E
    HC(["HR Admin corrects directly:<br/>hr_correct_attendance, reason required"]) --> J
    F --> RB{Raised by a manager?}
    RB -- Yes --> G3
    RB -- No --> CL{Date in a closed month?<br/>last day passed in IST}
    CL -- No --> G["Approvals inbox:<br/>reporting manager, or HR Admin (override)"]
    CL -- Yes --> G2{Employee is the HR Admin?}
    G2 -- No --> G3[HR Admin only] --> H
    G2 -- Yes --> G4["HR Admin's reporting manager only<br/>(narrow, audited exception)"] --> H
    G --> H{"process_regularisation:<br/>approver is manager or HR · approver ≠ employee"}
    H -- No --> H1[403 with reason]
    H -- Yes --> I{Decision}
    I -- Approve --> J["One transaction: old punches written to audit_log,<br/>then attendance row updated (or created) with the corrected times"]
    J --> FIN{Month already finalised by HR?}
    FIN -- No --> K[Day status recalculated on read: Present / Half Day / Absent by hours<br/>flows into the final CSV]
    FIN -- Yes --> PA["Same transaction: one payroll_adjustment<br/>= new buckets − last payroll-accounted state<br/>shown in next month's CSV, outside its day total<br/>finalised CSV never changes"]
    I -- Reject --> L[Day becomes Absent immediately]
    F --> M{No decision before the month closes?}
    M -- Yes --> L2["Day shows Absent when HR finalises the month<br/>(HR's month-end check tool flags these before cutoff)<br/>a later approval becomes an adjustment"]
```

## Wireframes

Low-fidelity. The yellow rule notes under each frame link what's on screen to a rule ID in RESEARCH.md.

| # | Screen (brief) | Who sees it | File |
| --- | --- | --- | --- |
| 01a | Home dashboard — Employee | Everyone | ![](docs/wireframes/01-dashboard-employee.png) |
| 01b | Home dashboard — Manager | Managers | ![](docs/wireframes/02-dashboard-manager.png) |
| 01c | Home dashboard — HR Admin | HR | ![](docs/wireframes/03-dashboard-hr.png) |
| 02a–c | Apply leave (3 steps: dates → review days, balance and LOP → confirm; other-half half days allowed; ML requests weeks and goes to HR) | Everyone | ![](docs/wireframes/04-apply-leave-step1.png) ![](docs/wireframes/05-apply-leave-step2.png) ![](docs/wireframes/06-apply-leave-step3.png) |
| 03 | Check-in (phone) | Everyone | ![](docs/wireframes/07-mobile-checkin.png) |
| 04 | Apply leave (phone) | Everyone | ![](docs/wireframes/08-mobile-apply-leave.png) |
| 05 | Ask HR (phone) | Everyone | ![](docs/wireframes/09-mobile-ask-hr.png) |
| 05b | Ask HR (desktop side panel) | Everyone | ![](docs/wireframes/21-ask-hr-desktop.png) |
| 06 | My profile (masked statutory data; HR Reveal is logged) | Everyone | ![](docs/wireframes/10-my-profile.png) |
| 07 | Employee directory | HR | ![](docs/wireframes/11-employee-directory.png) |
| 08 | Add / edit employee (validation on every Indian field) | HR | ![](docs/wireframes/12-add-employee.png) |
| 09 | My attendance (calendar + regularisation) | Everyone | ![](docs/wireframes/13-my-attendance.png) |
| 10 | Team attendance | Managers, HR | ![](docs/wireframes/14-team-attendance.png) |
| 11 | My leave (balances + history) | Everyone | ![](docs/wireframes/15-my-leave.png) |
| 12 | Approvals inbox | Managers, HR | ![](docs/wireframes/16-approvals.png) |
| 13 | Leave calendar (clashes) | Managers, HR | ![](docs/wireframes/17-leave-calendar.png) |
| 14 | Settings (locations, departments, holidays, leave types, policy text) | HR | ![](docs/wireframes/18-settings.png) |
| 15 | Reports (month-end CSV, Finalise, prior-month adjustments outside the day total) | Managers (own team), HR | ![](docs/wireframes/19-reports.png) |
| 16 | Dashboard states | Everyone | ![](docs/wireframes/20-states-dashboard.png) |

**Coverage of the brief's 13 screens:** Home dashboard, My profile, Employee directory, Add/edit employee, My attendance, Team attendance, Apply leave, My leave, Approvals inbox, Leave calendar, Ask HR, Settings, Reports. All 13 are covered.

## Sample data (shared by the wireframes and seed.sql)

All names are illustrative. `seed.sql` must recreate these exactly so the demo matches the wireframes.

- **Locations:**
  - Panaji HO: weekly offs Saturday + Sunday
  - Verna plant: weekly off Sunday
- **Departments:** Management, Finance, Production, Quality.
- **People:** 20 employees.

  | Person | Code | Role | Reports to | Site |
  | --- | --- | --- | --- | --- |
  | Vikram Sardesai | KCF0001 | MD; leave auto-approved | — | Panaji |
  | Meera Kamat | KCF0002 | HR Admin | Vikram | Panaji |
  | Anita Naik | — | Finance manager, 6 direct reports | — | Panaji |
  | Sanjay Prabhu | — | Plant manager | — | Verna |
  | Priya Desai | KCF0008 | Employee; main demo persona | Anita | Panaji |
  | Suresh Gawas | KCF0014 | Employee | Sanjay | Verna |
  | Neha Kerkar | KCF0019 | Inactive | — | — |

  - Neha's last working day was 30 Sep 2026; use her for the "can't log in" test.
  - Managers are worked out from reporting lines: Vikram, Anita and Sanjay make 3.
- **Holidays 2026:**
  - 2 Oct Gandhi Jayanti (National, both sites)
  - 3 Dec Feast of St Francis Xavier (State, both)
  - 19 Dec Goa Liberation Day (State, both; a Saturday)
  - 20 Oct Dussehra (Optional, both; a Tuesday, so OH can actually be used. A Sunday optional holiday would count 0 days.)
  - **14 Dec Plant maintenance shutdown (State, Verna only):** the holiday used for the location-isolation test
- **Priya's October 2026:** as on wireframe 01a.
  - 1 Late (6 Oct)
  - CL on 12–13 Oct
  - ½ CL + ½ Present on 22 Oct
  - Absent 21 Oct
  - Half Day 8 Oct
  - WFH 9 Oct
  - Pending regularisation 27 Oct

  Her balances: CL 1.5 (8 accrued, 6 used, 0.5 pending), SL 5, EL 19.5 (12 opening + 12.5 accrued − 5 used), OH 1.
