# RESEARCH.md — Konkan People (Konkan Coastal Foods HRMS)

> Author: Yash Parulekar · Research completed: 29 October 2026 · All legal positions checked against the sources listed at the end. Where the brief's policy refers to the law, the figure is verified and cited.

## Summary

Konkan Coastal Foods has two sites governed by different laws.

- **Panaji head office:** the Goa Shops and Establishments Act 1973. A 2025 replacement Act has been passed but not yet brought into force.
- **Verna plant:** a factory, under the Occupational Safety, Health and Working Conditions (OSH) Code 2020, in force since 21 November 2025.
- **Maternity leave:** now under the Code on Social Security 2020. It repealed the Maternity Benefit Act 1961 from the same date.

The leave policy I implement is written as numbered rules in the section "Leave and attendance policy as rules". Every rule is either taken from the brief or is a decision I made, with my reason.

---

## Q1. What does an Indian HR team keep for every employee?

**Mandatory**

- **Identity and contact:** employee code, legal first and last name, date of birth (also used to check age 18+ on joining), gender, mobile, email (used to match the login), address with PIN and state.
- **Job:** date of joining, designation, department, base location (decides the holiday calendar and weekly offs), reporting manager, employment status (worked out from the last working day).
- **Statutory and bank:**
  - **PAN:** mandatory, because it is needed to deduct TDS on salary.
  - **Bank details** (account number, IFSC, bank name): mandatory, because salary is credited to the account.
  - **Aadhaar:** mandatory in practice, because EPFO needs it to activate a UAN.
  - **UAN:** optional for new joiners, since it can be generated after joining.

**Formats validated by the app**

| Field | Format | Pattern |
| --- | --- | --- |
| PAN | 5 letters, 4 digits, 1 letter. The 4th letter is the holder type (P = individual); the 5th is the first letter of the surname | `^[A-Z]{5}[0-9]{4}[A-Z]$` |
| Aadhaar | 12 digits | `^[0-9]{12}$` |
| UAN | 12 digits, issued by EPFO, the same across jobs | `^[0-9]{12}$` |
| IFSC | 4-letter bank code, a 0 reserved for future use, 6-character branch code | `^[A-Z]{4}0[A-Z0-9]{6}$` |
| Mobile | 10 digits starting 6–9 | `^[6-9][0-9]{9}$` |
| PIN | 6 digits | `^[0-9]{6}$` |

**Sensitive**

- **Financial identifiers and government IDs** carry a serious identity-theft risk. Regulation 6 of the Aadhaar (Sharing of Information) Regulations 2016 states that an Aadhaar number "shall not be published, displayed or posted publicly", and any record containing it must be redacted. The DPDP Rules 2025 (notified 13 November 2025) list masking and access control as reasonable safeguards; their core duties apply from May 2027.
- **Blood group and emergency contact** are personal, but I let the direct manager read them as well as HR. If an employee is injured on the plant floor, the manager on site needs the blood group for first responders and the contact number for the family straight away. Sending that through HR, who may not be on site, causes dangerous delays.

## Q2. How is an employee code formed, and why should it never change?

- **Format:** a fixed prefix plus a zero-padded sequence, `KCF0001`. It does not include location, department or joining year, because those can change.
- **Why it never changes:** the code is the business key that links an employee across payroll, attendance and the HR audit trail. If it changed, the employee's history (leave, past payslips, audit entries) would be orphaned, and payroll could end up with duplicate identities.
- **Never reused:** an exited employee's code stays theirs forever. Reissuing it would merge two people's histories in every report.
- **In the database:** the code is a unique business key generated from a database sequence, so two HR users adding employees at the same moment cannot get the same number. Tables join on a separate UUID.

## Q3. Leave types, and statutory entitlement vs company policy

| Type | Purpose |
| --- | --- |
| Casual Leave (CL) | Short, unplanned personal needs |
| Sick Leave (SL) | Illness; a certificate is needed for longer absences |
| Earned Leave (EL) | Planned rest, earned progressively by months of service |
| Maternity Leave (ML) | Statutory paid leave for pregnancy, childbirth and recovery |
| Paternity Leave (PL) | Short paid leave for new fathers (company policy) |
| Loss of Pay (LOP) | Unpaid absence when no paid balance is left, or an unapproved absence. The Late penalty is a separate payroll deduction, not LOP leave. |
| Compensatory Off | A day off for working on a holiday or weekly off. It is statutory for factory workers, and the Goa Shops Act 2025 requires a compensatory day within 2 months if a weekly off is denied. Konkan's policy does not include it, so it is out of scope. |

**Statutory entitlement vs company policy.** A statutory entitlement is a legal minimum set by central or state law (e.g. the Code on Social Security, a state Shops Act). The company cannot go below it. Company policy is what the employer chooses on top of that, or where the law is silent (e.g. paternity leave, which has no private-sector mandate). Policy can exceed the legal minimum, but never fall below it.

**Is Konkan compliant?**

| Site | Law | SL floor | Konkan's 7 SL |
| --- | --- | --- | --- |
| Verna plant (a factory) | OSH Code 2020 | None; the Code sets only annual leave | Compliant |
| Panaji head office | Goa Shops Act 1973, s. 23(4): 9 SL + 6 CL | 9 | Likely 2 days short |
| Panaji under the 2025 Act (once in force) | Leave rules apply only at 20+ workers | 9, if 20+ staff | Depends on headcount |

I read these minimums as applying to each leave type separately, so 8 CL + 7 SL does not make up for a 9-day SL floor. On that reading, Konkan's SL is likely 2 days below the minimum for head-office staff under the 1973 Act; the plant is not affected. I would flag this to the client rather than silently change their policy. Because quotas are configurable (feature L1), the fix is a settings change, not a code change.

## Q4. How does leave accrue, and what happens at year end?

**Accrual styles**

- **Lump sum on 1 January:** Konkan uses this for CL and SL, pro-rated for joiners (rules B1–B5).
- **Monthly credit:** Konkan uses this for EL, at 1.25 days on the 1st of the following month (rules C1–C7).
- **Earned per days worked:** the statutory style, e.g. the OSH Code's 1 day per 20 days worked. Konkan doesn't use it.

**Year-end outcomes**

- **Lapse:** CL and SL do not carry into the next year.
- **Carry forward:** EL, capped at 30 days. This cap is the same as the OSH Code s. 32 carry-forward limit.
- **Encashment:** paying out unused leave. This is payroll, so it is out of scope.

## Q5. The Goa Shops and Establishments Act

| Topic | Goa Shops Act 1973 (in force) | Goa Shops Act 2025 (not yet in force) | OSH Code 2020 (plant) |
| --- | --- | --- | --- |
| Daily / weekly hours | 8 h / 48 h | 10 h / 48 h | 8 h / 48 h, max 6 days a week |
| Rest interval | 1 h after 5 h | 30 min after 5 h | Set by rules |
| Spread-over | 12 h | 12 h (14 h for intermittent work) | Set by rules |
| Weekly off | 1 whole day a week | 24 consecutive hours, paid | — |
| Leave | 15 EL after 240 days worked (accumulates to 45); 9 SL; 6 CL | Same, for establishments with 20+ workers | 1 day per 20 days worked after 180 days; carry forward up to 30 |

**Why two Acts?** Goa passed a new Act in 2025 (Act 23 of 2025, published 1 October 2025). It only comes into force on a date the state notifies, and no such notification has been issued, so I cite the 1973 Act as the law in force. **Future compliance check:** once the 2025 Act commences, most of its provisions (including leave) apply only to establishments with 20 or more workers. Whether they apply at Panaji will then depend on the head-office headcount. *Commencement check, 29 October 2026: no notification bringing the 2025 Act into force was found. Searched: the Act's text on PRS (s. 1(4) leaves the date to a future notification), TeamLease RegTech's note on the 1 October 2025 notification (Notification No. 7/29/2025-LA/143), and a web search for a commencement notice. [Add: the Goa Official Gazette / Labour Department page you checked yourself, with its link.]*

**Is Konkan's schedule legal?** Yes, at both sites.

- **The 8 hours are worked hours.** With the 1973 Act's 1-hour break after 5 hours, the day spans about 9 hours (10:00–19:00), within the 12-hour spread-over limit. That is why "Present" means 8 or more hours worked, not 8 hours on site.
- **Panaji head office** (1973 Act): 5 days × 8 hours = 40 hours, within the 48-hour weekly cap.
- **Verna plant** (OSH Code): 6 days × 8 hours = 48 hours, exactly at both the weekly cap and the 6-day limit.

## Q6. National, state and restricted holidays

- **National holiday:** declared nationally and observed in every state (Republic Day, Independence Day, Gandhi Jayanti).
- **State holiday:** declared by the state government for establishments in that state (e.g. Goa Liberation Day, 19 December).
- **Restricted (optional) holiday:** a culturally significant day that remains a working day. Employees can apply to take it off, subject to manager approval.

**How the app treats them**

- **National and State holidays behave the same in code:** both close the location. The type is only a label.
- **Holidays are attached to a location, not a state,** because both sites are in Goa. The seed data includes a Verna-only closure to show the location test.
- **Optional holidays are a leave type, OH:** 2 a year, only on dates marked Optional for the employee's location, no half days, no carry forward, not pro-rated. A separate type stops employees from using up CL on festivals.
- **Goa Liberation Day 2026 falls on a Saturday.** Because Holiday ranks above Weekly Off (rule K1), it counts as a Holiday at both sites. At Panaji, that month's weekly-off count drops by one.

## Q7. Late arrivals, half days, WFH and missed punches

| Situation | Common practice | Konkan's rule |
| --- | --- | --- |
| Late arrival | A grace period, then a common pattern of 3 Lates = a half-day deduction | Check-in at 10:16:00 IST or later is Late (an assumed 10:00 start + 15 minutes' grace, up to 10:15:59). floor(Lates ÷ 3) × 0.5 day LOP. Lates on WFH days count too. |
| Work from home | Attendance judged on availability and output during core hours | WFH counts as Present, but the same hour thresholds apply |
| Half day | Usually set by hours worked | 8+ h Present, 4 to under 8 h Half Day, under 4 h Absent. On a half-day leave day the thresholds halve. |
| Missed punch | A regularisation request; unregularised days usually become LOP | The day shows Pending Regularisation. It becomes Absent if the request is rejected or the month closes. HR can override the manager. |

**The sandwich rule.** Under a sandwich rule, weekly offs or holidays falling between two leave days are charged as leave too. Leave on Friday and Monday would cost 4 days instead of 2. Konkan has no sandwich rule, and this matches the law: the Goa Shops Act 2025 s. 20(8) and the OSH Code both exclude holidays inside a leave period. In code, the priority order (Holiday > Weekly Off > Approved Leave) means weekends inside a leave stay Weekly Off.

| Leave from Friday to Monday | Panaji (Sat + Sun off) | Verna (Sun off) |
| --- | --- | --- |
| With a sandwich rule | 4 days | 4 days |
| Konkan | 2 days | 3 days (Saturday is a working day) |

## Q8. Interview

**Who:** [Name], HR Manager at a mid-sized IT services firm (about 200 employees). Relationship: [relation]. Date: [date]. Their system: greytHR, but they rely heavily on exporting to Excel.

**What they dislike**

1. **The month-end chase.** Payroll runs on the 1st, and HR spends the 30th and 31st chasing managers for approvals. An ignored request leads to an unfair pay cut, or HR edits the payroll sheet by hand.
2. **Balance enquiries.** Employees email HR to ask how much leave they will have left after a holiday. HR works it out in Excel.
3. **Missed punches.** Forgotten check-outs are the most common daily error, and there is no proof either way.
4. **Policy confusion.** Employees think one late arrival costs a half day, so they go home and take CL instead.

**How it changed my design**

- **HR can override approvals for regularisations as well as leave,** and a month-end check tool (the agent's extra tool) lists pending items before the cutoff and drafts reminders for HR.
- **The agent's balance and working-day tools** answer the "how much will I have left" question.
- **The dashboard shows** a "You haven't checked out" banner and a live "Late marks this month: X of 3" counter.

**Limitation:** the interviewee works at an IT firm. Konkan has a plant with a physical gate register, so missed-punch problems are probably worse there than described.

---
## Leave and attendance policy as rules

These are the rules the Konkan Coastal Foods HRMS implements. Rules marked **(brief)** come straight from the requirement document; every other rule is a decision I made where the brief was silent, with the reason.

### A. Leave year and leave types

- **A1 (brief).** The leave year runs 1 January to 31 December.
- **A2 (brief).** Leave types and quotas:

| Code | Type | Annual quota | Accrual | Year-end | Half day |
| --- | --- | --- | --- | --- | --- |
| CL | Casual Leave | 8 days | Credited 1 Jan, pro-rated for joiners | Lapses 31 Dec | Yes |
| SL | Sick Leave | 7 days | Credited 1 Jan, pro-rated for joiners | Lapses 31 Dec | Yes |
| EL | Earned Leave | 15 days | 1.25 per completed month | Carry forward up to 30 | No |
| ML | Maternity Leave | 26 or 12 weeks (Code on Social Security 2020, s. 60) | On request | Not applicable | No |
| PL | Paternity Leave | 5 working days (company policy) | On request | Not applicable | No |
| LOP | Loss of Pay | Unlimited | Not applicable | Not applicable | Yes |
| OH | Optional Holiday (added; not in the brief) | 2 days | Credited 1 Jan, not pro-rated | Lapses 31 Dec | No |

- **A3.** OH can only be applied for on a date marked Optional in the holiday calendar for the employee's location. It goes through normal manager approval. It is not pro-rated: someone joining in November still gets 2 if December has optional festivals. Reason for a separate type: employees should not have to use CL to observe a festival. The quota of 2 matches the central government's 2 restricted holidays a year.

### B. Pro-rating CL and SL for joiners

- **B1.** Months counted = full months from the month after joining to December, plus the joining month as 1 if joined on or before the 15th, or 0.5 if joined after the 15th.
- **B2.** Pro-rated quota = annual quota × months counted / 12.
- **B3.** Rounding is applied once, to the final total, never month by month, so rounding errors cannot compound.
- **B4.** The total is rounded to the nearest 0.5: a fraction of 0.01–0.24 rounds down to 0, 0.25–0.74 to 0.5, and 0.75–0.99 up to 1.0. Reason: CL and SL allow half days, so a half-day balance is always usable, and the quota is not inflated.
- **B5.** Worked examples:

| Joined | Months | CL | SL |
| --- | --- | --- | --- |
| 1 July | 6 | 8 × 6/12 = 4.0 | 7 × 6/12 = 3.5 |
| 15 July | 6 | 4.0 | 3.5 |
| 20 July | 5.5 | 3.67 → 3.5 | 3.21 → 3.0 |

### C. Earned Leave accrual

- **C1.** 1.25 EL is credited on the 1st of the month following each completed calendar month.
- **C2.** A month counts as completed only if the employee was employed from its 1st to its last day. A 20 July joiner gets nothing for July; their first credit is on 1 September. Reason: this avoids fractional daily accruals such as 11/31 of a month.
- **C3.** EL is accrued monthly, not front-loaded, so employees earn leave before taking it. This avoids negative balances and clawback if someone resigns early in the year after taking a full year's EL.
- **C4.** Opening EL on 1 January = min(EL balance on 31 December, 30). Anything above 30 lapses, because encashment is part of payroll and out of scope.
- **C5.** EL cannot be taken in half days. Fractions stay in the balance: with 6.25 EL an employee can take 6 days and the 0.25 carries forward.
- **C6.** December's 1.25 is credited on 1 January and counts toward the new year, after the 30-day cap in C4 has been applied. A tenured employee can therefore start January with up to 31.25 EL (30 opening + 1.25 accrued). Each calendar year still holds exactly 12 credits (1 January for December through 1 December for November) = 15 days.
- **C7.** Example: a 20 July joiner receives credits on 1 September, 1 October, 1 November and 1 December, so they have 5.0 EL on 31 December. The credit for December arrives on 1 January.

### D. Balance

- **D1 (brief).** Each employee sees opening, accrued, used, pending and available balance per leave type.
- **D2.** Available = opening + accrued − used − pending. Pending requests reduce the available balance so the same days cannot be booked twice.
- **D4.** Only the opening balance per employee, leave type and year is stored. Accrued, used, pending and available are calculated whenever they are read: used = approved leave-day lines for that type and year, and pending = lines on pending requests. Both leave out dates that are now holidays or weekly offs for the employee's location. Reason: a stored balance goes stale whenever HR adds a holiday or an employee cancels leave, and nothing would flag it. A calculated one cannot drift.
- **D3 (brief).** The used balance changes only when a request is approved.

### E. Counting leave days

- **E1 (brief).** Leave is counted in working days only, using the employee's location: Panaji works Monday to Friday; Verna works Monday to Saturday.
- **E2 (brief).** Weekly offs and holidays inside a leave period are never counted as leave. Konkan has no sandwich rule.
  - Leave from Friday to Monday is 2 days at Panaji (Fri, Mon) and 3 days at Verna (Fri, Sat, Mon).
- **E3.** Exception: ML is counted in calendar days (26 weeks = 182 days). Reason: the law grants weeks, not working days. Counting 182 working days would give about 36.4 weeks at Panaji and 30.3 weeks at Verna, which is unequal and not what the law says.
- **E4.** PL is counted in working days like other company leave. 5 days of PL is a full week off at Panaji; at Verna, Monday to Friday of PL means returning on Saturday.
- **E5.** The employee applies for ML with a start date and *requests* 12 or 26 weeks. The request goes to **HR, not the line manager**. HR checks eligibility (number of surviving children, 80 days worked in the prior 12 months) and confirms the duration. The employee's choice is only a request; it never sets their entitlement. The app does not verify the eligibility conditions itself.
- **E6.** PL (5 working days) follows the normal reporting-manager approval, because Konkan's policy assigns no eligibility check to HR.

### F. Applying for leave

- **F1 (brief).** Leave cannot be applied for more than 30 days in the past, counted as 30 calendar days back from today's date in IST.
- **F2.** Half-day leave is allowed only on a single-date request and must say First half or Second half. Two half-day requests on the same date are allowed if they cover different halves (e.g. first-half CL and second-half SL), as long as the day's total is at most 1.0.
- **F3.** A new request that overlaps a pending or approved request is blocked at submission, except for the different-halves case in F2. A full day overlapping anything, or the same half twice, is always blocked.
- **F5.** Leave cannot start before the employee's joining date or end after their last working day.
- **F6.** A request that covers 0 chargeable days (e.g. only weekly offs or holidays) is refused.
- **F4 (brief).** SL of more than 2 consecutive days requires a medical certificate.
  - "Consecutive" is counted in working days. SL on Friday and Monday at Panaji is 2 days and needs no certificate; Thursday, Friday and Monday is 3 and does.
  - The certificate must be uploaded before the request can be submitted. An employee who is too ill to upload applies after returning, using the 30-day back-dating rule (F1). This avoids a "pending documentation" state.

### G. Insufficient balance and LOP

- **G1 (brief).** An employee cannot apply for more leave than their available balance; the app offers to convert the excess to LOP.
- **G2.** The result is one request, not two. Each date in the request is stored as its own line with its own leave type (for example 2 days CL + 1 day LOP). Reason: two linked requests could be half-approved by mistake, breaking up a continuous absence.
- **G3.** The paid balance is used up first, in date order; the last days become LOP. For types that allow half days (CL, SL), one date can be split 0.5 paid + 0.5 LOP. **EL allows only whole days:** an EL balance of 6.25 on a 7-day request gives 6 EL + 1 LOP, and the 0.25 stays in the balance for later. Reason: it is deterministic and matches how people think: you spend what you have, then you run out.
- **G4.** Each dated line is charged to its own year. For leave from 30 December to 2 January, the December days use this year's CL and the January days use next year's fresh quota.

### H. Approval

- **H1 (brief).** A request goes to the employee's reporting manager, who approves or rejects it with a comment.
- **H2.** A manager's own leave goes to their reporting manager.
- **H3.** An employee with no reporting manager (the MD) has leave auto-approved on submission. The balance check still runs, the approver is left empty, and the request is noted "Auto-approved: no reporting manager". Reason: no one in the system has authority over the MD's leave, and routing it to HR would ask HR to approve their own boss.
- **H4.** The HR Admin's leave goes to their reporting manager. The seed data always gives the HR Admin a manager.
- **H5.** HR Admin can approve or reject anyone's leave except their own. Reason: a fail-safe when a manager is absent or has left, so requests do not stay stuck before month end.
- **H6 (brief).** No one can approve their own leave. This is enforced on the server and by a database check (approver is never the applicant).
- **H7.** Approval and rejection apply to the whole request. A manager who wants to approve only part of it rejects it and asks the employee to apply again.
- **H8.** When a manager is deactivated, HR assigns their direct reports a new manager, and the manager's pending requests move to the HR Admin's queue.
- **H9.** ML requests go to the HR Admin (E5). So does any leave request with a date in a finalised payroll month (L7).

### I. Cancellation and exit

- **I1 (brief).** An employee can cancel a pending request, or an approved request that has not started; the balance is restored.
- **I2.** Once the first day of an approved request has passed, the employee cannot cancel any part of it. HR can shorten it, and the change is recorded in the audit log.
- **I3.** When HR sets a last working day, any leave dated after it is cancelled automatically and the balance restored.
- **I4.** If HR adds a holiday that falls inside approved leave, that day stops counting as leave and its balance is restored, because Holiday ranks above leave (rule K1).

### J. Attendance

- **J1 (brief).** All times are stored and shown in IST (Asia/Kolkata).
- **J2 (brief).** Worked 8 hours or more: Present. 4 to under 8 hours: Half Day. Under 4 hours or no punch: Absent.
- **J3 (brief).** WFH counts as Present, but the same hour thresholds apply: 8+ hours = Present (reported in the WFH column), 4 to under 8 = Half Day, under 4 = Absent.
- **J4 (brief + decision).** A Late mark is recorded when the employee's IST check-in time is 10:16:00 or later. Check-ins up to 10:15:59 are within the permitted grace period. This applies equally to office and WFH attendance. Reason for including WFH: it changes where the employee works, not the hours; exempting it would treat office staff more harshly.
- **J5 (brief + decision).** Late penalty = floor(Late marks in the calendar month / 3) × 0.5 LOP. The 3rd Late gives 0.5, the 6th gives 1.0 in total. Reason: penalising every Late after the 3rd would make a late arrival cost as much as staying home, which pushes people to take the half day off instead.
- **J6.** A day with a check-in but no check-out shows as Pending Regularisation. It becomes Absent when the regularisation is rejected, or when the month closes without one. This status is calculated when it is read, not set by a scheduled job.
- **J7 (brief).** A regularisation changes attendance only after manager approval.
- **J8.** On a half-day leave day, the hour thresholds halve. 4 or more hours worked = 0.5 leave + 0.5 Present; under 4 hours = 0.5 leave + 0.5 Absent.
- **J9.** Punches on a holiday or weekly off are recorded, but the day still shows Holiday or Weekly Off (rule K1).
- **J10.** An approved regularisation writes the original punches to `audit_log` and updates the attendance times in one transaction.
- **J11.** A past working day with no punch and no approved leave is Absent and can still be regularised. Future dates are never Absent.
- **J12.** A month is closed once its last day has passed in IST. After that, only the HR Admin can approve a regularisation or correction for a date in that month; the employee's manager can no longer approve it.
  - **Exception:** the HR Admin's own correction for a closed month goes to the HR Admin's reporting manager. This is a narrow, audited exception that gives that manager no other HR rights. Nobody ever approves their own correction.
- **J13.** "Correct an attendance record" (brief role table):
  - **The HR Admin** can correct any record directly. A reason is mandatory, and the original punches are kept in the audit log.
  - **A manager** can only *request* a correction for a direct report. The request goes to HR for approval.
  - **An employee** uses regularisation (J7).

### K. What a day counts as

- **K1.** Each day falls into exactly one bucket, decided in this order, highest first:
  1. Inside an ML period: ML
  2. National or State holiday for the employee's location (Optional holidays are working days unless the employee has approved OH leave, which falls under step 4)
  3. Weekly off for the employee's location
  4. Approved leave (wins over any punch, per the brief)
  5. Attendance from punches: Present, WFH, Half Day, Absent or Pending
  6. Future dates: not counted
- **K2.** Because Holiday ranks above Weekly off, a holiday on Saturday is a Holiday at both Panaji and Verna. At Panaji, that month's weekly-off count drops by one.

### L. Month-end summary (CSV)

- **L1.** Day columns: Present, WFH, CL, SL, EL, ML, PL, OH, LOP_leave, Absent, Holidays, Weekly_offs. For every employee they add up to the number of days in the month.
- **L2.** A Half Day without leave adds 0.5 to Present and 0.5 to Absent.
- **L3.** Late_LOP = floor(Late marks / 3) × 0.5 is a separate column outside the day sum, so the Present count still matches the calendar.
- **L4.** Total_LOP (for the payroll vendor) = Absent + LOP_leave + Late_LOP.
- **L5 (brief).** PAN, Aadhaar and bank numbers are masked in the CSV.
- **L6.** Before the month closes, the CSV is marked provisional and Pending Regularisation days sit outside the buckets. After the month closes, unresolved pending days become Absent, so in the final CSV every row adds up to the full number of calendar days. Late_LOP always stays outside that total.
- **L6a.** There are two different ideas, and both matter:
  - **Calendar month closed:** the month's last day has passed in IST. From then on, only HR approves corrections for it (J12).
  - **Payroll month finalised:** HR has explicitly locked that month's export. From then on, corrections become adjustments (L7).

  HR **finalises** a month on or after its close. Finalising does three things:
  - creates the final CSV, which is stored and never regenerated
  - records what was counted for each employee and day
  - turns any still-unresolved pending days into Absent

  Finalising is all-or-nothing: either the CSV, its checksum and every snapshot are saved together, or nothing is, and the month stays unfinalised. Corrections to a past month that has never been finalised, however late, simply flow into that month's first final CSV.
- **L8.** Settings that would change a finalised month's numbers are locked. Holidays dated in a finalised payroll month cannot be added, edited or removed, and leave settings cannot be changed for a year that already has a finalised month. Attendance and leave corrections are **not** blocked; they continue through adjustments (L7).
- **L9.** A manager's month-end download contains only their direct reports, including only their reports' adjustments. It is built on the server from authorised records (the finalised snapshots, or live data if the month isn't finalised). The company-wide CSV is HR-only and never sent to a manager's browser.
- **L7.** The CSV for a finalised month never changes. If HR later approves a correction for a closed-month date, the difference is recorded as a payroll adjustment:
  - The adjustment appears once, in the **next unfinalised** payroll export (normally the following month), in separate columns: adjustment days, original date and reason.
  - It is outside that month's calendar-day total, because it belongs to the previous month.
  - Each correction can create only one adjustment.
  - Sources of an adjustment: an approved regularisation, a back-dated or HR-shortened leave request, or an HR direct correction.
  - A second legitimate correction to the same date is allowed. It is compared with the **last payroll-accounted state** (the finalised day plus any earlier adjustments), not with the original punches.
  - Example: 27 Oct was Absent because a regularisation was unresolved. HR approves it on 3 Nov, confirming a full day worked. October's CSV is unchanged, and November's CSV carries −1.0 LOP dated 27 Oct.

---

## Sources

**Primary**

- [Goa Shops and Establishments Act 2025 (Act 23 of 2025), PRS](https://prsindia.org/files/bills_acts/acts_states/goa/2025/Act23of2025GA.pdf)
- [Goa, Daman and Diu Shops and Establishments Act 1973, Goa Labour Department](https://labour.goa.gov.in/wp-content/uploads/2020/07/7475-31-SI-EOG-1-GDD-Shops-Establishment-Act-1973-31-10-1974.pdf)
- [Aadhaar (Sharing of Information) Regulations 2016, UIDAI](https://www.uidai.gov.in/images/The_Aadhaar_Sharing_of_information_regulation_2016.pdf)
- [How PAN is formed, Income Tax Department](https://www.incometaxindia.gov.in/w/how-pan-is-formed-and-how-it-gets-its-unique-identity-)
- [Goa 2026 public holidays notice, Government of Goa](https://www.goa.gov.in/wp-content/uploads/2025/10/GOVT-NOTIFIES-PUBLIC-HOLIDAYS.pdf)

**Legal commentary**

- [Labour code enforcement dates (21 Nov 2025), SCC Online](https://www.scconline.com/blog/post/2025/11/26/enforcement-dates-of-labour-codes-legal-news/)
- [Maternity benefits under the Code on Social Security, KS&K](https://ksandk.com/labour-employment/india-maternity-benefit-rules-2026/)
- [OSH Code and Central Rules 2026 FAQ, Acuity Law](https://acuitylaw.co.in/md/faqs/faqs-on-the-occupational-safety-health-and-working-conditions-code-2020-and-the-occupational-safety-health-and-working-conditions-central-rules-2026/)
- [OSH Code annual leave, Simpliance](https://simpliance.in/blog/?p=915)
- [DPDP Rules 2025 highlights, Mondaq](https://www.mondaq.com/india/privacy-protection/1707558/digital-personal-data-protection-rules-2025-highlights)
- [UIDAI Aadhaar Data Vault clarification, Mondaq](https://www.mondaq.com/india/privacy-protection/1719124/vaulting-to-safety-uidai-issues-clarifications-on-applicability-of-aadhaar-data-vault-requirements)
- [Goa Shops Act 2025 notification, TeamLease RegTech](https://teamleaseregtech.com/updates/article/47481/goa-shops-and-establishments-regulation-of-employment-and-conditions-o/)

**HR practice**

- [Goa holidays 2026, greytHR](https://www.greythr.com/wiki/acts/st-goa/holidays/2026/) · [Paternity leave, greytHR](https://www.greythr.com/blog/paternity-leave/) · [Comp-off, greytHR](https://www.greythr.com/blog/compensatory-off/)
- [Sandwich leave, Keka](https://www.keka.com/sandwich-leave-policy) · [Sandwich leave, PocketHRMS](https://www.pockethrms.com/blog/what-is-sandwich-leave-policy/)
- [Late-coming policy, factoHR](https://factohr.com/policy/late-coming-policy-for-employees/) · [Attendance policy, factoHR](https://factohr.com/policy/attendance-policy-for-employees/)
- [National and restricted holidays, Zimyo](https://www.zimyo.com/resources/insights/list-of-restricted-and-national-holidays-in-india) · [Central govt holidays 2026, Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fcentre-releases-list-of-holidays-in-2026-govt-offices-to-remain-shut-on-these-dates-3812986)
- [UAN, ClearTax](https://cleartax.in/s/universal-account-number) · [IFSC, Oliveboard](https://www.oliveboard.in/blog/indian-financial-system-code/)
