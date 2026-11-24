import { createFileRoute } from "@tanstack/react-router";
import { PixelizeApp } from "@/components/pixelize-app";

export const Route = createFileRoute("/")({ component: PixelizeApp });
