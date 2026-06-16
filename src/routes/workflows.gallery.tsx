import { createFileRoute } from "@tanstack/react-router";
import { WorkflowGalleryPage } from "@/components/WorkflowGallery";

export const Route = createFileRoute("/workflows/gallery")({
  component: WorkflowGalleryPage,
});
