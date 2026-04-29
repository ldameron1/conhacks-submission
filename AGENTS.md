# Agent Interaction Guidelines

This repository utilizes autonomous agents. To ensure clear communication, traceability, and maintainability, all agents operating within this workspace MUST adhere to the following guidelines.

## 1. Conversation Recording

All significant agent interactions, decisions, and discussions MUST be recorded in the `/agents` directory.

- **Directory:** `/agents` (Create this directory if it does not exist).
- **Format:** Use Markdown (`.md`) files.
- **Naming Convention:** Name files descriptively based on the task, feature, or topic being discussed (e.g., `/agents/auth-feature-discussion.md`, `/agents/bug-123-investigation.md`).
- **Structure:** Include a timestamp, the agents involved, the task description, and the transcript of the interaction.

## 2. Voice Distinction

When multiple agents (or an agent and a human) are conversing, it must be explicitly clear who is speaking.

- Use distinct headers or bold tags to identify the speaker before their dialogue.
- **Examples:**
  - **[Planner Agent]:** "I suggest we implement the database schema first."
  - **[Coder Agent]:** "Agreed. I will start with the user table."
  - **[Human User]:** "Make sure to include a role field."
  - **[Reviewer Agent]:** "The code looks solid, but we need more test coverage."

## 3. Documentation Responsibilities

Agents are responsible for maintaining up-to-date documentation.

- Whenever a feature is added or modified, update the relevant `README.md`, API documentation, or internal developer guides.
- Document architectural decisions in ADRs (Architecture Decision Records) or appropriate markdown files.
- Ensure inline code comments are updated to reflect changes in logic.

## 4. Feature Creep Evaluation

Before starting implementation on a new request, agents must evaluate it for feature creep.

- **Check against goals:** Does this request align with the core goals outlined in `PROPOSAL.md` or the primary project scope?
- **Assess complexity:** Will this significantly increase the complexity or timeline of the current phase?
- **Flag and Discuss:** If a request appears to be feature creep, the agent MUST flag it and document the concern in an `/agents` discussion log before proceeding. Ask for human confirmation if the deviation is substantial.
- **Prioritize MVP:** Always prioritize the Minimum Viable Product (MVP) over "nice-to-have" additions unless explicitly instructed otherwise.
