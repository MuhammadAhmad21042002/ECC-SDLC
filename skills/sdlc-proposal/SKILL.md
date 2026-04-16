---
name: sdlc-proposal
description: >
  Proposal writing methodology for ECC-SDLC Pakistani government and GCC banking
  RFP responses. Load this skill when assembling proposals from SDLC artifacts.
  Covers document purpose/audience headers, 9-section structure, assumptions &
  constraints, win theme extraction, TCO pricing, compliance statements
  (SBP-2024, PPRA-2024, SAMA-2024), diagram placement, and RFP response patterns.
  Used by proposal-writer agent during /proposal command.
---

# SDLC Proposal Skill

## Purpose

This skill defines the proposal writing methodology used by the Proposal Writer
agent during the `/proposal` command. It covers proposal structure conventions,
pricing narrative techniques, win theme extraction, compliance statement
requirements, and RFP response patterns specific to Pakistani government and
GCC banking procurement contexts.

Every proposal produced by the Proposal Writer agent must conform to the
structural conventions and narrative techniques in this skill. The proposal
is assembled from upstream artifacts in state.json (SRS, SDS, STS, estimate)
and transformed into a client-facing document that aligns with local
procurement evaluation criteria.

---

## 0. Pre-Section Headers

Before Section 1 (Executive Summary), every proposal MUST include two
short standalone headings. These appear after the version history table
and before the TOC body — they orient the reader immediately.

### 0.1 Document Purpose

State in 2–3 sentences what this document is, what decision it supports,
and what it does NOT cover.

Example (Pakistani government):

```text
This Technical Proposal responds to the Federal Board of Revenue's Request
for Proposal (RFP-FBR-2026-ICT-004) for an AI-Powered Taxpayer Knowledge
Platform. It presents wAI Industries' proposed solution, technical approach,
team, cost model, and compliance attestations. This document does not
constitute a legally binding offer; a formal contract will be executed
upon bid award.
```

Example (GCC banking):

```text
This Technical Proposal responds to Abu Dhabi Commercial Bank's Request for
Proposal for a Real-Time Fraud Detection System. It details the proposed
architecture, implementation methodology, team qualifications, and commercial
terms. Regulatory compliance documentation referenced herein is available
for verification upon request.
```

### 0.2 Intended Audience

List the specific roles expected to read this document. This signals
that the proposal is purpose-written, not generic.

Example:

```text
This proposal is intended for the following readers at {clientName}:
- Procurement Committee — for commercial and compliance evaluation
- Chief Information Officer / IT Director — for technical approach review
- Project Sponsor / Business Owner — for solution fit and timeline assessment
- Legal / Contracts Team — for terms, payment schedule, and warranty review
```

The agent MUST populate both fields from state.json context. If client
contacts are unknown, use role-based descriptions (as above) — never leave
blank or use placeholder text.

---

## 1. Proposal Structure — Pakistani Government & GCC Banking

The standard section order for RFP responses in Pakistani government (PPRA-governed)
and GCC banking (SBP/SAMA/CBUAE-regulated) contexts follows a specific sequence
that differs from Western proposal formats. This order is optimized for
compliance-first evaluation criteria used by procurement committees in these
industries.

### 1.1 Full Document Structure

Every proposal MUST follow this exact order:

```
[Cover Page]
[Table of Contents]
[Version History]
Document Purpose          ← NEW (pre-section, no number)
Intended Audience         ← NEW (pre-section, no number)
1. Executive Summary
2. Understanding of Requirement
   2.1 Client Objectives
   2.2 Regulatory Context
   2.3 Key Success Criteria
   2.4 Assumptions & Constraints    ← NEW
       2.4.1 Assumptions
       2.4.2 Constraints
3. Proposed Solution
   3.1 Solution Overview
   3.2 Key Features
   3.3 Win Themes
4. Technical Approach
   4.1 System Architecture
       [Figure 1a — Architecture PNG (if rendered)]
       [Figure 1b — Architecture Mermaid source]
       [Figure 2  — Data Flow Diagram]          ← NEW
       [Figure 3  — Deployment Diagram]         ← NEW
   4.2 Technology Stack
   4.3 Development Methodology
       [Figure 4  — Process Flowchart]          ← NEW
   4.4 Quality Assurance
   4.5 Integration Flows                        ← NEW
       [Figure 5  — Sequence Diagram]           ← NEW
5. Team Profiles
6. Project Timeline
   6.1 Phase-Based Delivery Schedule
7. Cost Breakdown
   7.1 Total Cost of Ownership (3-Year)
   7.2 Payment Schedule
8. Compliance Statement
   8.1 Regulatory Framework Adherence
   8.2 Compliance Gaps and Mitigation
   8.3 Organizational Certifications
   8.4 Compliance Matrix
9. Appendices
   Appendix A — Company Profile
   Appendix B — Past Performance References
   Appendix C — Certifications
   Appendix D — Key Personnel CVs
   Appendix E — Technical Specifications
```

### 1.2 Section-Specific Guidance

#### Executive Summary

- Lead with the client's business objective — not your solution features
- Include a one-sentence win theme statement in the first paragraph
- State total project cost and delivery timeline in the second paragraph
- Reference applicable regulatory compliance (SBP-2024, PPRA-2024, SAMA-2024)
- Maximum 2 pages — procurement committees skip long summaries

Pakistani government example opening:

```text
The Federal Board of Revenue requires an AI-powered knowledge platform to
reduce taxpayer query resolution time from 48 hours to under 4 hours while
maintaining PPRA-2024 compliance and ensuring full Urdu language support.
Our proposed solution delivers this outcome through a cloud-native platform
with integrated NLP capabilities, deployable within 8 months at a total
project cost of PKR 75 million.
```

GCC banking example opening:

```text
Abu Dhabi Commercial Bank seeks a real-time fraud detection system capable
of processing 50,000 transactions per second while maintaining CBUAE regulatory
compliance and achieving sub-200ms latency. Our proposed architecture leverages
event-driven microservices with ML-based anomaly detection, delivering full
operational capability within 10 months at AED 12.5 million.
```

#### Understanding of Requirement

- Restate the client's challenge in their own language — quote the RFP directly
- Demonstrate deep understanding of their regulatory environment
- Identify implicit requirements they may not have articulated
- Show awareness of industry-specific pain points

For Pakistani government clients:

- Reference PPRA procurement rules explicitly
- Acknowledge data sovereignty and on-premise hosting preferences
- Note language requirements (Urdu + English)
- Demonstrate understanding of public sector budget cycles

For GCC banking clients:

- Reference the specific central bank (SBP, SAMA, CBUAE, CBK)
- Acknowledge Islamic finance requirements if applicable (AAOIFI)
- Note data residency and localization mandates
- Demonstrate understanding of regional payment systems (RAAST, SWIFT gpi)

#### 2.4 Assumptions & Constraints — NEW SECTION

This section protects both parties from scope disputes and sets clear
expectations before contract signature.

**Assumptions** are conditions the vendor assumes to be true in order
for the proposal to be valid. If an assumption proves false, the scope
or cost may need revision.

**Constraints** are fixed boundaries imposed on the project that the
vendor cannot change — regulatory, technical, or organizational.

Populate from state.json: read `requirements` array for constraint-tagged
items, and infer assumptions from scope document and SRS.

Example assumptions:

```text
- The client will provide access to existing systems and APIs within 2 weeks
  of project kickoff.
- A named client project manager with decision-making authority will be
  available for weekly status reviews.
- The client's on-premise infrastructure meets the minimum specifications
  defined in Appendix E.
- UAT will be completed by the client within 3 weeks of each delivery milestone.
- All source data for migration will be provided in agreed formats by Week 4.
```

Example constraints:

```text
- The system must be hosted on-premise within Pakistan (SBP data residency rule).
- The solution must support Urdu and English interfaces (PPRA language mandate).
- The project must go live before the fiscal year end (June 30, 2027).
- The system must integrate with the existing SAP ERP using the current REST API.
- Budget is fixed at PKR 75 million — no cost escalation clauses will be accepted.
```

---

## 2. Win Theme Extraction

Win themes are client-benefit statements derived from must-priority requirements.
They are NOT feature descriptions. A win theme articulates why the client should
choose this proposal by connecting solution capabilities to the client's
strategic objectives.

### 2.1 Win Theme Definition

A win theme has three components:

1. **Client objective** — what the client is trying to achieve
2. **Your differentiator** — what makes your approach better
3. **Proof point** — evidence that you can deliver this benefit

Format: `"By [your differentiator], we enable [client objective], as demonstrated by [proof point]."`

### 2.2 Extracting Win Themes from Must-Priority Requirements

Algorithm:

1. Read all requirements with `priority: "must"` from state.json
2. Group must-requirements by business domain (authentication, reporting, compliance, etc.)
3. For each domain group, identify the underlying client objective
4. Articulate what makes your proposed approach better than alternatives
5. Reference a past project or certification as proof

### 2.3 Examples

Pakistani government RFP — tax system:

```text
Must-requirement: "The system shall support Urdu and English with real-time
language switching."

Win theme: "By implementing native Urdu NLP with context-aware translation,
we enable FBR to serve 70% of Pakistani taxpayers in their preferred language,
as demonstrated by our Urdu-first chatbot deployment for Punjab Revenue
Authority (2024) which achieved 89% user satisfaction."
```

GCC banking RFP — fraud detection:

```text
Must-requirement: "The system shall detect fraudulent transactions within
200ms at p95."

Win theme: "By leveraging event-driven architecture with in-memory rule
evaluation, we enable ADCB to block fraudulent transactions before settlement,
as demonstrated by our real-time fraud platform for Emirates NBD (2023)
which achieved 99.2% fraud detection accuracy with 180ms p95 latency."
```

### 2.4 Win Theme Placement

- Executive summary: 1 primary win theme in the opening paragraph
- Understanding of requirement: 2-3 win themes connecting to client pain points
- Proposed solution: 3-5 win themes mapping to must-priority requirements
- Technical approach: win themes as subheadings for major components

### 2.5 Anti-Patterns — What is NOT a Win Theme

- "Our solution uses microservices architecture" — feature description, not benefit
- "We have 15 years of experience" — credential, not client-specific benefit
- "The system will be fast and secure" — vague claim with no proof
- "Our team is highly skilled" — generic statement with no differentiation

---

## 3. Pricing Narrative Techniques — Regulated Industry Clients

Pricing for SBP-regulated banks and PPRA-governed government projects follows
different conventions than commercial B2B sales. The goal is transparent cost
justification, not sales persuasion.

### 3.1 Total Cost of Ownership (TCO) Framing

Always present TCO, not just development cost. Regulated-industry procurement
committees evaluate lifecycle cost, not upfront price.

Components to include:

- **Development cost** — one-time implementation
- **Infrastructure cost** — servers, cloud hosting, licenses (Year 1-3)
- **Training cost** — end-user training and train-the-trainer programs
- **Maintenance cost** — annual support and bug fixes (Year 1-3)
- **Enhancement cost** — estimated cost for Phase 2 features (optional line item)

Example TCO breakdown:

```text
Total Cost of Ownership (3-Year Horizon):
- Development (one-time): PKR 45 million
- Infrastructure (Year 1-3): PKR 12 million
- Training (one-time): PKR 3 million
- Annual maintenance (Year 1-3): PKR 5 million/year
-------------------------------------------------
Total 3-Year TCO: PKR 75 million
```

### 3.2 Avoiding Day-Rate Exposure

NEVER present pricing as day rates or hourly rates in Pakistani government or
GCC banking proposals. This pricing model is perceived as unfamiliar and
creates budget uncertainty for procurement committees.

Instead, use fixed-price line items tied to deliverables:

| Wrong (Day-Rate Model) | Correct (Deliverable Model) |
| --- | --- |
| Senior developer: 120 days @ USD 800/day | Requirements & Design Phase: PKR 15 million (fixed) |
| Project manager: 180 days @ USD 1200/day | Development Phase: PKR 25 million (fixed) |
| QA engineer: 80 days @ USD 600/day | Testing & UAT Phase: PKR 8 million (fixed) |

If the RFP explicitly requests resource-hour breakdowns, include them in an
appendix, not in the main cost section.

### 3.3 Local Currency and Payment Milestones

- Always quote in local currency: PKR (Pakistan), AED (UAE), SAR (Saudi), KWD (Kuwait)
- Never use USD unless the RFP explicitly requires it
- Tie payment milestones to phase gate completions, not calendar dates

Standard milestone structure for Pakistani government:

```text
Payment Schedule:
- 20% upon contract signing and project kickoff
- 30% upon SRS and SDS approval
- 30% upon UAT completion and client sign-off
- 15% upon production deployment and go-live
- 5% upon completion of warranty period (90 days post-deployment)
```

Standard milestone structure for GCC banking:

```text
Payment Schedule:
- 15% upon contract signing and security clearance
- 25% upon design approval and infrastructure provisioning
- 35% upon UAT sign-off and penetration testing clearance
- 20% upon production deployment and central bank audit completion
- 5% upon completion of warranty period (180 days post-deployment)
```

### 3.4 Contingency and Risk Reserves

Pakistani government projects (PPRA context):

- Include a separate line item for "contingency reserve" at 10-15% of development cost
- Label it explicitly: "Contingency Reserve for Scope Clarifications"
- Justify it: "Reserved for requirement refinements identified during UAT, per PPRA Rules 2024"

GCC banking projects:

- Include a separate line item for "regulatory compliance buffer" at 5-10% of development cost
- Label it: "Regulatory Compliance and Audit Support"
- Justify it: "Reserved for additional security requirements identified during [SBP/SAMA/CBUAE] review"

### 3.5 Cost Comparison and Value Justification

For high-value projects (>PKR 50 million or >AED 5 million), include a brief
cost comparison section:

```text
Cost-Benefit Analysis:

Option A — Manual Process (Status Quo):
- Annual operational cost: PKR 12 million
- Error rate: 8-12%
- Processing time: 48-72 hours

Option B — Proposed Automated System:
- One-time investment: PKR 75 million
- Annual operational cost: PKR 2 million
- Error rate: <1%
- Processing time: <4 hours
- Break-even period: 18 months
- 5-year ROI: 340%
```

This framing positions your proposal as an investment, not an expense.

---

## 4. RFP Response Patterns — Document Mapping

The proposal is NOT written from scratch. It is assembled from upstream
artifacts in state.json. This section defines the mapping between state.json
artifacts and proposal sections.

### 4.1 Source Artifact Mapping

| Proposal Section | Primary Source | Secondary Sources |
| --- | --- | --- |
| Document Purpose | RFP reference number + scope document | state.json projectName/clientName |
| Intended Audience | Scope document stakeholder register | state.json clientName |
| Executive Summary | Scope document + win themes | SRS (must-requirements) |
| Understanding of Requirement | Scope document + SRS | Meeting notes, RFP original text |
| Assumptions & Constraints | SRS (REQ-CON-* items) + scope | Estimate (timeline assumptions) |
| Proposed Solution | SRS (functional requirements) | SDS (high-level architecture) |
| Technical Approach | SDS (architecture + components) | STS (testing strategy) |
| Team Profiles | Company profile (user-provided) | Past project references |
| Project Timeline | Estimate (timeline section) | SDS (phase dependencies) |
| Cost Breakdown | Estimate (financial model) | Rate cards (user-provided) |
| Compliance Statement | Compliance matrix | Framework definitions (SBP, PPRA, etc.) |
| Appendices | All artifacts + certifications | User-provided company documents |

### 4.2 Requirements-to-Proposal Transformation

Extract must-priority requirements from state.json and transform them into
client-benefit language:

| SRS Requirement Format | Proposal Narrative Format |
| --- | --- |
| "The system shall authenticate users via CNIC and password." | "Your officers will securely access the system using their existing CNIC credentials, eliminating the need for separate username management and reducing helpdesk password reset requests by an estimated 60%." |
| "The system shall encrypt all data at rest using AES-256." | "All sensitive taxpayer data will be protected using bank-grade AES-256 encryption, ensuring full compliance with SBP data security guidelines and protecting against unauthorized access even in the event of physical server compromise." |
| "The system shall support 10,000 concurrent users." | "During peak filing season, up to 10,000 tax officers across Pakistan will be able to access the system simultaneously without performance degradation, ensuring uninterrupted service during your highest-demand periods." |

The transformation rule: convert "shall" statements into "your organization will" benefits.

### 4.3 Diagram Placement — All Five Diagram Types

The proposal supports five diagram types. All are rendered as Mermaid source
blocks in the docx (paste into mermaid.live or the Word Mermaid add-in to view).
The architecture diagram additionally renders as a PNG when dagre+sharp are available.

| Diagram | Template Section | Figure # | Mermaid Type | What It Shows |
| --- | --- | --- | --- | --- |
| Architecture Diagram | 4.1 System Architecture | Figure 1 | `graph TD` or `C4Context` | High-level system layers and components |
| Data Flow Diagram | 4.1 System Architecture | Figure 2 | `graph LR` | How data moves between actors and components |
| Deployment Diagram | 4.1 System Architecture | Figure 3 | `graph TD` with infra nodes | Servers, containers, cloud zones, network boundaries |
| Process Flowchart | 4.3 Development Methodology | Figure 4 | `flowchart TD` | Dev → test → deploy cycle or business process flow |
| Sequence Diagram | 4.5 Integration Flows | Figure 5 | `sequenceDiagram` | API call sequences, auth flows, inter-service comms |

**Agent instruction — populating diagram fields:**

Read architecture and design content from `state.json.artifacts.sds.path`.
Generate Mermaid source for each diagram type based on design components
and integration patterns documented in the SDS.

All five diagram data keys are **optional** in the template — if the SDS does
not contain enough detail to generate a specific diagram type, leave the
corresponding field as an empty array `[]`. The `renderCondition` on each
template block will suppress it from the rendered document automatically.

The architecture diagram (`architectureDiagramLines`) is in `requiredFields`
and must always be populated.

**Mermaid examples by diagram type:**

Data Flow Diagram:
```
graph LR
  User -->|HTTP Request| API[API Gateway]
  API -->|Validates| Auth[Auth Service]
  Auth -->|Token| API
  API -->|Query| DB[(PostgreSQL)]
  DB -->|Results| API
  API -->|Response| User
```

Deployment Diagram:
```
graph TD
  subgraph Cloud[AWS / On-Premise]
    LB[Load Balancer]
    subgraph AppTier[Application Tier]
      App1[App Server 1]
      App2[App Server 2]
    end
    subgraph DataTier[Data Tier]
      PG[(PostgreSQL Primary)]
      PGR[(PostgreSQL Replica)]
    end
  end
  Internet --> LB --> App1 & App2 --> PG --> PGR
```

Process Flowchart:
```
flowchart TD
  A[Developer commits code] --> B{CI Pipeline}
  B -->|Tests pass| C[Build Docker image]
  B -->|Tests fail| D[Notify developer]
  C --> E[Deploy to staging]
  E --> F{UAT approval?}
  F -->|Approved| G[Deploy to production]
  F -->|Rejected| H[Return to development]
```

Sequence Diagram:
```
sequenceDiagram
  participant C as Client App
  participant G as API Gateway
  participant A as Auth Service
  participant S as Core Service
  C->>G: POST /login (credentials)
  G->>A: Validate credentials
  A-->>G: JWT token
  G-->>C: 200 OK + token
  C->>G: GET /data (Bearer token)
  G->>A: Verify token
  A-->>G: Valid
  G->>S: Fetch data
  S-->>G: Data payload
  G-->>C: 200 OK + data
```

### 4.4 Traceability Cross-Reference

In the Technical Approach section, include a traceability matrix showing:

- Requirement ID (REQ-FUNC-NNN)
- Requirement title (short form)
- Design component addressing it (DC-NNN)
- Test case validating it (TC-NNN)

This demonstrates rigorous engineering discipline to procurement committees
evaluating technical competence.

---

## 5. Compliance Statement Requirements

Every proposal for a Pakistani government or GCC banking client MUST include
a compliance statement section with named references to applicable regulatory
frameworks. This is not optional. Omitting this section will result in
automatic disqualification in most PPRA-governed and central-bank-regulated
procurement processes.

### 5.1 Mandatory Framework References

Pakistani government projects (PPRA-governed):

```text
Compliance Statement:

This proposal and the proposed solution are designed to comply with the
Public Procurement Regulatory Authority (PPRA) Rules 2024. Specifically:

- The proposed procurement process follows PPRA Rule 12 (competitive bidding)
- All cost breakdowns adhere to PPRA Schedule III (standard bidding documents)
- The project timeline includes mandatory PPRA-compliant milestone inspections
- The proposed contract structure follows PPRA's standard conditions of contract

Additionally, all data handling and storage procedures comply with the
Prevention of Electronic Crimes Act (PECA) 2016.
```

Pakistani banking projects (SBP-regulated):

```text
Compliance Statement:

This proposal and the proposed solution are designed to comply with the
State Bank of Pakistan (SBP) IT Governance Framework 2024. Specifically:

- Data encryption standards meet SBP-SEC-001 (AES-256 at rest, TLS 1.2+ in transit)
- Authentication mechanisms satisfy SBP-SEC-002 (multi-factor authentication)
- Audit logging follows SBP-DATA-003 (7-year retention with tamper-evidence)
- Data residency requirements comply with SBP-DATA-001 (Pakistan-hosted only)
- KYC and AML procedures align with SBP BPRD Circular No. 07/2023
```

GCC banking projects (SAMA/CBUAE/CBK-regulated):

```text
Compliance Statement:

This proposal and the proposed solution are designed to comply with the
Saudi Arabian Monetary Authority (SAMA) Cybersecurity Framework 2024.
Specifically:

- All security controls meet SAMA-CYB-001 through SAMA-CYB-015 requirements
- Data residency complies with SAMA's Cloud Computing Regulatory Framework (2021)
- Incident response procedures align with SAMA Circular No. 18/2020
- Third-party risk management follows SAMA's Outsourcing Guidelines (2020)
```

### 5.2 Gap Acknowledgment

If the compliance matrix from the Compliance Checker agent identified any gaps,
they MUST be disclosed in the compliance statement with proposed mitigation:

```text
Identified Compliance Gaps and Mitigation Plan:

Gap: SBP-SEC-005 (Biometric Authentication) — The proposed solution in Phase 1
      uses CNIC + password authentication, not biometric.

Mitigation: We propose implementing biometric authentication (fingerprint +
            facial recognition) in Phase 2, scheduled for Month 10-12 post-
            deployment. In the interim, we will implement compensating controls:
            - Hardware token-based 2FA for high-privilege users
            - Behavioral analytics for anomaly detection
            - Enhanced session monitoring and automatic timeout (5 minutes)
```

### 5.3 Certification Evidence

```text
Organizational Compliance Credentials:

- ISO 27001:2013 (Information Security Management) — Certificate No. [XXX]
- ISO 9001:2015 (Quality Management) — Certificate No. [XXX]
- CMMI Level 3 (Software Development Maturity) — Appraisal ID [XXX]
- PCI-DSS v3.2.1 Service Provider Level 1 — Certificate No. [XXX] (if applicable)

All certificates are available for verification in Appendix C.
```

---

## 6. Appendices Content Checklist

### 6.1 Mandatory Appendices

- **Appendix A: Company Profile** — Registration, tax certificates, org chart, offices
- **Appendix B: Past Performance References** — 2+ similar projects with client contacts
- **Appendix C: Certifications** — ISO 27001, ISO 9001, CMMI, individual certs
- **Appendix D: Key Personnel CVs** — PM, architect, lead dev, security lead (2 pages max each)
- **Appendix E: Technical Specifications** — Full SDS + STS + infrastructure sizing

### 6.2 Optional Appendices (Include if Differentiating)

- **Appendix F: Commercial Documents** — Detailed cost breakdown, payment schedule, warranty terms
- **Appendix G: Compliance Attestations** — Signed compliance statement, data residency attestation
- **Appendix H: Prototype or Demo Screenshots** — Real deployed system only, max 5 screenshots
- **Appendix I: Risk Register and Mitigation Plan** — Shows maturity and planning discipline
- **Appendix J: Change Management and Training Plan** — Training curriculum, ADKAR/Kotter methodology

---

## 7. Quality Validation Checklist

### 7.1 Structural Validation

- [ ] Document Purpose heading present (pre-section, before TOC body)
- [ ] Intended Audience heading present (pre-section, before TOC body)
- [ ] All 9 mandatory sections present in correct order
- [ ] Section 2.4 Assumptions & Constraints present with both sub-lists
- [ ] Executive summary is 1-2 pages maximum
- [ ] All diagrams are Mermaid source blocks (PNG additionally for architecture if rendered)
- [ ] All tables have clear headers and are properly formatted
- [ ] Table of contents includes all sections with correct page numbers
- [ ] Document version and date on cover page and footer
- [ ] Company logo and client name on cover page

### 7.2 Content Validation

- [ ] Document Purpose names the specific RFP reference
- [ ] Intended Audience lists specific roles (not generic "stakeholders")
- [ ] Assumptions & Constraints list has at least 3 items each
- [ ] At least 1 primary win theme in executive summary
- [ ] At least 3 win themes in proposed solution section
- [ ] All must-priority requirements from SRS are addressed in proposed solution
- [ ] Architecture diagram populated (required field)
- [ ] At least 1 additional diagram populated (data flow, deployment, flowchart, or sequence)
- [ ] Team profiles include project manager with relevant certifications
- [ ] Project timeline shows phase gates and milestone payment triggers
- [ ] Cost breakdown presented as TCO (3-year horizon minimum)
- [ ] Compliance statement names SBP-2024, PPRA-2024, or SAMA-2024 (as applicable)
- [ ] All appendices referenced in main body are actually included

### 7.3 Compliance Validation

- [ ] Regulatory framework explicitly named in compliance statement
- [ ] Any compliance gaps disclosed with mitigation plans
- [ ] All certifications referenced are valid (not expired)
- [ ] Past performance references include client contact information
- [ ] All cost figures use local currency (PKR, AED, SAR, KWD)

### 7.4 Language and Tone Validation

- [ ] No technical jargon without explanation
- [ ] No vendor-specific product names unless required by RFP
- [ ] All requirements transformed from "shall" to "will enable you to" language
- [ ] No marketing fluff or exaggerated claims
- [ ] Professional tone appropriate for government/banking procurement committee
- [ ] Urdu language support mentioned if client is Pakistani government

### 7.5 Anti-Pattern Detection

- [ ] No day rates or hourly rates in main cost section
- [ ] No "industry standard" without defining the specific standard
- [ ] No "best-in-class" or "world-class" without proof
- [ ] No feature lists without client benefit transformation
- [ ] No passive voice in win theme statements
- [ ] No USD pricing unless explicitly requested by RFP
- [ ] No blank Document Purpose or Intended Audience fields

---

## 8. Common Mistakes and Corrections

| Mistake | Fix |
| --- | --- |
| Missing Document Purpose section | Always include — state the RFP reference number explicitly |
| Generic "Intended Audience: All stakeholders" | List specific roles: Procurement Committee, CIO, Legal Team |
| Missing Assumptions & Constraints (2.4) | Always include — minimum 3 assumptions and 3 constraints |
| "Our solution uses cutting-edge AI technology" | "Your officers will resolve taxpayer queries 70% faster through NLP-powered knowledge search" |
| Pricing in USD for Pakistani government RFP | Always use PKR unless RFP explicitly requires USD |
| Generic compliance: "We will comply with all regulations" | Name the specific framework: "SBP IT Governance Framework 2024, Control SBP-SEC-001" |
| Win theme: "We have 15 years of experience" | "By leveraging our 6 successful SBP-audited deployments since 2018, we reduce your regulatory approval risk" |
| Only architecture diagram included | Include at least one additional diagram — data flow or deployment are easiest to generate from SDS |
| Sequence diagram placed under architecture | Sequence diagrams go under Section 4.5 Integration Flows |
| Flowchart placed under architecture | Process flowcharts go under Section 4.3 Development Methodology |
| Mermaid source code visible as raw text in proposal | Wrap in mermaidBlock template section — renderer adds code fence + label |
| Day-rate pricing: "Senior dev: 120 days @ $800/day" | "Development Phase: PKR 25 million (fixed price, includes all development resources)" |
| Executive summary is 5 pages long | Maximum 2 pages — procurement committees skip long summaries |
| No appendices included | Every claim must have evidence in appendices |
| No payment milestones tied to deliverables | Tie payment to phase gate completions: "30% upon SRS/SDS approval" |
| Compliance gaps hidden or ignored | Disclose gaps with mitigation: "Gap: biometric auth — mitigation: Phase 2 implementation" |

---

## 9. Output Format

The Proposal Writer agent outputs a complete proposal as a .docx file using
the docx-js library. The file must include:

- Cover page with company logo, client name, proposal title, date, version
- Table of contents with automatic page numbering
- Document Purpose and Intended Audience headings (unnumbered, before Section 1)
- All 9 mandatory sections in order
- Section 2.4 Assumptions & Constraints with both sub-lists
- All diagram mermaidBlock sections populated (architecture required; others as available from SDS)
- All appendices
- Footer with page numbers and document version
- Professional styling: Calibri or Arial 11pt, 1.15 line spacing, justified alignment

File naming convention: `{ClientName}-{ProjectName}-Proposal-v{N}.docx`

Example: `FBR-AI-Knowledge-Platform-Proposal-v1.docx`

---

## 10. Integration with State.json

The proposal assembly process reads from state.json and does NOT modify it.
The Proposal Writer agent is read-only.

Required state.json fields:

- `artifacts.srs.path` — source of must-requirements for win themes and assumptions
- `artifacts.sds.path` — source of architecture diagrams, deployment info, and integration flows
- `artifacts.sts.path` — source of testing strategy and traceability matrix
- `artifacts.estimate.path` — source of cost breakdown and timeline
- `complianceFlags` array — source of regulatory framework references
- `traceabilityMatrix` object — source of requirement-to-design-to-test mapping

New diagram fields populated from:

- `dataFlowDiagramLines` — from SDS data flow section
- `deploymentDiagramLines` — from SDS infrastructure/deployment section
- `processFlowchartLines` — from SDS or STS methodology section
- `sequenceDiagramLines` — from SDS API/integration section

If any of these artifacts are missing, the Proposal Writer agent must block
and report the missing prerequisite.

---

## 11. Pakistani vs. GCC Context Switching

The proposal structure is identical for both contexts, but the language,
regulatory references, and pricing currency must adapt based on client location.

### 11.1 Detection Rule

Read the client name and project context from state.json:

- If client is in Pakistan OR regulatory framework includes PPRA-2024 OR currency is PKR → Pakistani government context
- If client is in Pakistan OR regulatory framework includes SBP-2024 → Pakistani banking context
- If client is in UAE/Saudi/Kuwait OR regulatory framework includes SAMA/CBUAE/CBK → GCC banking context

### 11.2 Adaptation Matrix

| Element | Pakistani Government | Pakistani Banking | GCC Banking |
| --- | --- | --- | --- |
| Currency | PKR | PKR | AED/SAR/KWD |
| Regulatory reference | PPRA-2024, PECA 2016 | SBP-2024, SBP BPRD circulars | SAMA/CBUAE/CBK frameworks |
| Language mention | Urdu + English support mandatory | Urdu + English support recommended | Arabic + English (UAE/Saudi) |
| Payment milestones | 5 milestones, 90-day warranty | 5 milestones, 180-day warranty | 5 milestones, 180-day warranty |
| Team localization | 50% Pakistani nationals (PPRA clause) | No mandatory localization | GCC national preference (optional) |
| Contingency label | "PPRA Scope Clarification Reserve" | "SBP Compliance Buffer" | "Regulatory Audit Support Reserve" |

---

## 12. Final Checklist Before Delivery

- [ ] Document Purpose section populated with RFP reference
- [ ] Intended Audience lists specific roles (not generic)
- [ ] All 9 sections present in correct order
- [ ] Section 2.4 Assumptions & Constraints has both sub-lists with real content
- [ ] Win themes extracted from must-priority requirements
- [ ] TCO pricing model used (not day rates)
- [ ] Compliance statement names specific regulatory framework (SBP/PPRA/SAMA)
- [ ] Architecture diagram populated (required)
- [ ] At least one additional diagram populated from SDS content
- [ ] Sequence diagram placed under 4.5 Integration Flows (not 4.1)
- [ ] Process flowchart placed under 4.3 Development Methodology (not 4.1)
- [ ] All appendices included
- [ ] Local currency used throughout
- [ ] Payment milestones tied to phase gate deliverables
- [ ] Traceability matrix included in Technical Approach section
- [ ] No anti-patterns detected
- [ ] Document quality validation passed
- [ ] File saved to .sdlc/artifacts/ directory
- [ ] State.json updated with proposal artifact metadata

---

End of SDLC Proposal Skill
