import { createFileRoute } from "@tanstack/react-router";
import { ERDDesigner } from "@/components/designer/ERDDesigner";

export const Route = createFileRoute("/entities/erd")({ component: ERDDesigner });
