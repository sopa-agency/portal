// Default, user-editable AI instructions (shown in the "Editar prompt" option of
// the Improve-with-AI buttons). Kept out of "use server" action files (those may
// only export async functions) so both server actions and client components can
// import them.

export const MEETING_AI_INSTRUCTION =
  "Melhore a PAUTA e escreva o EMAIL de convite — em português, claros, objetivos e amigáveis.";
