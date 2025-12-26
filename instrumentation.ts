import { registerOTel } from "@vercel/otel";
import { BraintrustExporter } from "@braintrust/otel";

export function register() {
  console.log(process.env.NODE_ENV);
  registerOTel({
    serviceName: "deep-search",
    traceExporter: new BraintrustExporter({
      parent: `project_name:${process.env.PROJECT_NAME}`,
      filterAISpans: true, // Only send AI-related spans
    }),
  });
}
