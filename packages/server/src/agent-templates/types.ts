/* AgentTemplate — kiểu chung cho template agent theo phòng ban. */
export interface AgentTemplate {
  id: string;
  department: string;
  departmentKey: string;
  icon: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  temperature: number;
  tags: string[];
}
