- [x] Verify that the copilot-instructions.md file in the .github directory is created.

- [x] Clarify Project Requirements
	Ask for project type, language, and frameworks if not specified. Skip if already provided.

- [x] Scaffold the Project
	Ensure the previous step is complete, call the project setup tool with the correct projectType, run the scaffolding command in '.', and create files manually only when no template fits.

- [x] Customize the Project
	Confirm prior steps are done, plan modifications that satisfy the user request, then apply them (skip only for simple hello-world skeletons).

- [x] Install Required Extensions
	Only install extensions explicitly listed by get_project_setup_info; otherwise note that nothing was required.

- [x] Compile the Project
	Install dependencies, run the documented diagnostics, and resolve issues before moving on.

- [x] Create and Run Task
	Only create a VS Code task when the project actually benefits from one; otherwise mark the step as intentionally skipped.

- [x] Launch the Project
	Ask the user whether they want a dev server or debugger started before launching anything.

- [x] Ensure Documentation is Complete
	Confirm README.md plus this file describe the current project and keep this checklist free of HTML comments.

## Execution Guidelines
**Progress tracking**
- Use the manage_todo_list tool to mirror this checklist.
- Mark each step complete with a short summary once finished.
- Review the current todo status before beginning another step.

**Communication rules**
- Keep explanations short and avoid dumping command output.
- When skipping a step, document that briefly (for example, "No extensions needed").
- Do not describe the entire project structure unless asked directly.

**Development rules**
- Run all commands from the repository root (".").
- Avoid adding media or links unless the user explicitly requests them.
- Call the VS Code API helper only for extension projects.
- Never instruct the user to re-open the workspace in Visual Studio.
- Honor any extra rules returned by get_project_setup_info.

**Folder creation rules**
- Keep work inside the current directory.
- Only create new folders when the user asks (besides .vscode for tasks).
- If a scaffold command wants a different folder name, ask the user to rename and reopen.

**Extension installation rules**
- Install only the extensions explicitly listed by get_project_setup_info.

**Project content rules**
- Default to a "Hello World" app only when requirements are unclear.
- Skip adding integrations, assets, or media unless required.
- Note when placeholders should be replaced later.
- Confirm unstated requirements with the user before implementing them.

**Task completion rules**
- Finish once the project scaffolding, customization, documentation, and launch guidance are in place.
- Ensure README.md plus this file reflect the current project state.
- Provide the user with clear steps for building, testing, and running the app.
- Work through each checklist item systematically.
- Keep communication concise and focused.
- Follow development best practices.
