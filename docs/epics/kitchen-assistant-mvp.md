# Kitchen-Aware Assistant — MVP Scope v0

**Status:** Scoping / clarification required
**Product area:** Kitchen-Aware Assistant
**Goal:** Deliver one small vertical slice of a larger food + wellness product.

## 1. MVP Objective

Build a conversational Kitchen-Aware Assistant that acts as the user's primary point of contact for:

* current kitchen state,
* changes to kitchen state,
* understanding what food is available,
* helping the user determine what they can make,
* basic meal-planning context.

The experience begins as chat-first.

User messages are interpreted into structured, persistent state. The UI reacts to that state through adaptive widgets so the user can visually observe their kitchen/context changing as they talk to the assistant.

The first MVP should prove that:

> A conversational assistant can maintain a useful representation of the user's kitchen and turn that context into visible, useful meal decisions without requiring traditional inventory-management workflows.

## 2. Primary Experience

The workspace contains two major regions.

### Adaptive workspace

Approximately 2/3 of the available workspace in the larger layout.

This region displays widgets based on the current conversation and user state.

Example:

> User:
> I bought eggs, chicken thighs, spinach and yogurt.

The workspace may surface a kitchen/inventory widget showing the interpreted kitchen state.

The user can then ask:

> What can I make?

The adaptive workspace should change to show meal-related information derived from the same kitchen state.

The goal is for the user to visibly observe:

```
conversation → interpretation → state change → useful output
```

### Conversation

Approximately 1/3 of the larger workspace.

The user communicates naturally with the Kitchen-Aware Assistant.

For the initial MVP, the interaction is chat-based.

The assistant should be able to interpret messages such as:

> I bought eggs and spinach.
> I used the rest of the spinach.
> I froze the chicken.
> What can I make tonight?
> Add that to my meal plan.

The chat is not merely a chatbot interface. It is an input mechanism into persistent product state.

## 3. Adaptive Widget System

The UI should not be a fixed dashboard containing every possible feature.

Widgets should appear or update based on:

* user requests,
* current conversational task,
* state changes,
* relevant kitchen context.

The widget architecture should be extensible so future assistants/features can introduce additional surfaces without requiring the Kitchen Assistant to own all UI.

The first MVP should implement only the minimum widget types needed to validate the Kitchen Assistant experience.

Exact MVP widget set: pending clarification.

## 4. Persistent User Context

User interaction must not exist only inside an LLM conversation window.

Relevant information should be persisted in a database so that future sessions can reference historical context.

The system needs to support the concept of:

```
event history → current interpreted state → future reasoning
```

Example:

```
Day 1:
Bought chicken.

Day 3:
Froze two pieces.

Day 6:
Used one piece.
```

The system should retain enough history to reconstruct how its understanding changed instead of storing only an overwritten `chicken = 1` value.

This allows future capabilities such as:

* tracking changes over time,
* correcting past assumptions,
* predictions,
* freshness reasoning,
* behavioral patterns,
* personalization,
* analytics.

The MVP does not need to implement all of these capabilities.

It only needs to avoid choosing a data architecture that prevents them.

## 5. Transferable Context

The larger product will eventually contain other specialist assistants such as:

* Health & Wellness,
* Fitness Coach,
* nutrition-related features,
* potentially additional personal assistants.

Therefore Kitchen data should not become inaccessible state buried inside one assistant's prompt or proprietary memory structure.

The architecture should distinguish between:

### Shared user context

Information potentially relevant across the product.

Examples may eventually include:

* user identity,
* preferences,
* goals,
* timestamps,
* activity/event history,
* provenance,
* explicit statements,
* inferred information.

### Domain context

Information primarily owned by a particular product domain.

For Kitchen this includes concepts such as:

* ingredients,
* storage,
* quantities,
* kitchen events,
* meals,
* meal planning.

The exact shared schema must be determined during architecture design rather than prematurely encoding Health/Fitness requirements into the Kitchen MVP.

## 6. Existing Interaction Principles

The MVP should preserve product decisions already established during discovery.

### Do not require fake precision

If the user says:

> I bought some chicken.

The system may know with high confidence that chicken exists while having unknown quantity.

Unknown fields should remain unknown rather than forcing the user to provide unnecessary information.

### Avoid interrogation

The assistant should only ask for clarification when missing information prevents it from completing something useful.

### Conversation can update state

The user should not have to enter every inventory change through forms.

### Current state and history are different concepts

The current kitchen state may be derived from a sequence of historical events.

### Temporary intent is not automatically permanent preference

A request for a particular cuisine or type of meal should not automatically rewrite the user's long-term profile.

## 7. Accessibility

Accessibility is a first-class requirement.

The UI/UX specialist is responsible for accessibility during design rather than treating it as a final QA pass.

The specific accessibility compliance target is still to be selected.

Mobile-first behavior must also be defined before the layout is considered final.

## 8. MVP Platform

Not yet selected.

This decision affects:

* responsive layout,
* widget behavior,
* mobile interactions,
* frontend technology,
* deployment,
* future device capabilities.

The platform must be decided before technical architecture is finalized.

## 9. Specialized Agent Team

The currently required specialist roles are:

### Product / Course Owner — Vero

Owns:

* product decisions,
* MVP boundaries,
* acceptance/rejection of specialist recommendations,
* final tradeoffs.

Agents should advise rather than silently redefine product requirements.

### UI/UX + Accessibility Specialist

Responsible for:

* mobile-first information architecture,
* conversational workspace layout,
* adaptive widget behavior,
* accessibility,
* interaction states,
* empty/loading/error states,
* component behavior specifications.

### Frontend Engineering Specialist

Responsible for:

* frontend architecture,
* adaptive widget rendering,
* chat interaction,
* responsive behavior,
* state synchronization,
* accessibility implementation,
* frontend testing.

### Backend / Data Engineering Specialist

Responsible for:

* API architecture,
* persistent context,
* kitchen-state model,
* event/history model,
* data integrity,
* database decisions,
* interfaces future assistants can consume.

### Ownership still unresolved

AI interpretation/context behavior may either:

* belong to the backend specialist, or
* become a separate AI/Application Intelligence specialist.

This should be decided before agent responsibilities are finalized.

## 10. Epic

**Epic:** Kitchen-Aware Assistant — Conversational Kitchen State

### Outcome

A user can communicate naturally with the Kitchen-Aware Assistant, have relevant kitchen information persisted, see that information reflected through adaptive widgets, and use the resulting kitchen context to support a meal decision.

### Epic success

The feature is successful when a test user can complete the agreed primary journey from:

```
message → persisted kitchen update → visible widget update → meal-related action
```

without manually maintaining a traditional inventory database.

### Explicitly outside the Epic until approved

* Health Coach UI
* Fitness Coach UI
* calorie tracking
* workout tracking
* receipt scanning
* photo inventory
* Siri integration
* advanced freshness prediction
* grocery purchasing
* sophisticated recipe-source ranking
* autonomous long-term behavioral prediction

The architecture may preserve future compatibility with these systems without implementing them.

## 11. Architecture Principle

The first vertical slice should prove the product interaction while creating a clean boundary between:

```
conversation
↓
interpretation
↓
persistent events / structured state
↓
domain services
↓
adaptive UI widgets
```

Future assistants should be able to consume appropriate shared context through defined interfaces rather than directly reading another assistant's prompt history.

## 12. Definition of MVP

The MVP will be considered scoped only after the remaining questions below are answered.

No additional features should be added simply because they would eventually be useful.

### Remaining questions

* What is the exact first successful user journey?
* Which widgets are required in MVP 1?
* How deep does Meal Plan go: save one meal, a few upcoming meals, or a calendar?
* How much detail should Meal Ideas include: name/why only, or ingredients/recipe/source too?
* Are widgets interactive, or mostly visual in the first build?
* Does history need to be visible to the user, or only stored?
* Which kitchen fields are mandatory on day one: quantity, unit, storage location, dates, etc.?
* Is this responsive web, PWA, or native mobile?
* Is MVP single-user/dogfood only, or does it need auth/multiple users?
* What accessibility target should we use?
* How should incorrect AI interpretations be corrected: confirmation, undo, or conversational correction?
* Should AI/context behavior have its own specialist agent, or live under backend initially?
