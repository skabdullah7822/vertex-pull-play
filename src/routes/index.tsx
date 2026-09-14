import { createFileRoute } from "@tanstack/react-router";
import ModelEditor from "@/components/editor/ModelEditor";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "RenderCraft — 3D Modeler with Vertex Dragging" },
      {
        name: "description",
        content:
          "Build 3D scenes in the browser: add meshes and lights, move, rotate, scale, and sculpt any surface by dropping points and dragging them.",
      },
      { property: "og:title", content: "RenderCraft — 3D Modeler with Vertex Dragging" },
      {
        property: "og:description",
        content:
          "Add meshes and lights, transform them, and reshape surfaces by dragging control points directly on the model.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ModelEditor,
});
