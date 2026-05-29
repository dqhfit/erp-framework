import { createFileRoute } from "@tanstack/react-router";
import { AgentLibraryPage } from "@/components/AgentLibrary";

export const Route = createFileRoute("/agents/library")({
  component: AgentLibraryPage,
});
