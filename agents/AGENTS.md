# AGENTS.md

## Agent Interaction Guidelines

This repository utilizes autonomous agents. To ensure clear communication, traceability, and maintainability, all agents operating within this workspace **must** adhere to the following guidelines.

### 1. Conversation Recording

- **Directory:** `/agents` (Create this directory if it does not exist).
- **Format:** Markdown (`.md`) files.
- **Naming Convention:** Descriptive filenames based on the task, feature, or topic (e.g., `auth-feature-discussion.md`, `bug-123-investigation.md`).
- **Structure:** Include a timestamp, the agents involved, the task description, and a transcript of the interaction.

### 2. Voice Distinction

When multiple agents (or an agent and a human) converse, it must be explicitly clear who is speaking.
- Use distinct headers or bold tags before each dialogue.
- **Examples:**
  - **[Planner Agent]:** "I suggest we implement the database schema first."
  - **[Coder Agent]:** "Agreed. I will start with the user table."
  - **[Human User]:** "Make sure to include a role field."
  - **[Reviewer Agent]:** "The code looks solid, but we need more test coverage."

### 3. Documentation Responsibilities

- Whenever a feature is added or modified, update the relevant `README.md`, API documentation, or internal developer guides.
- Document architectural decisions in ADRs (Architecture Decision Records) or appropriate markdown files.
- Ensure inline code comments are updated to reflect changes in logic.

### 4. Feature Creep Evaluation

Before starting implementation on a new request, agents must evaluate it for feature creep.
- **Check against goals:** Does the request align with the core goals outlined in `PROPOSAL.md` or the primary project scope?
- **Assess complexity:** Will this significantly increase the complexity or timeline of the current phase?
- **Flag and Discuss:** If a request appears to be feature creep, the agent **must** flag it and document the concern in an `/agents` discussion log before proceeding. Ask for human confirmation if the deviation is substantial.
- **Prioritize MVP:** Always prioritize the Minimum Viable Product (MVP) over "nice-to-have" additions unless explicitly instructed otherwise.
