import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Heatmap diff viewer for code reviews",
  description:
    "Color-coded diff viewer that highlights lines and tokens by how much human attention they need.",
};

export default function HeatmapPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-white p-8 text-black">
      <div className="mx-auto mb-0 mt-[70px] max-w-3xl">
        <Link
          href="https://cmux.dev"
          className="mb-8 inline-block text-sm text-neutral-600 hover:text-black"
        >
          ← Back to <span className="bg-sky-100 px-1">cmux</span>
        </Link>
        <h1 className="mb-8 text-3xl font-bold">
          A <span className="bg-yellow-200 px-1">heatmap</span> diff viewer for
          code reviews
        </h1>

        <div className="mb-8 text-base leading-[1.6]">
          <p className="mb-4">
            Heatmap color-codes every diff line/token by how much{" "}
            <span className="bg-yellow-200 px-1">human attention</span> it
            probably needs. Unlike PR-review bots, we try to flag not just by
            &ldquo;is it a bug?&rdquo; but by &ldquo;is it worth a second
            look?&rdquo; (examples:{" "}
            <span className="bg-red-300 px-1">hard-coded secret</span>,{" "}
            <span className="bg-orange-300 px-1">weird crypto mode</span>,{" "}
            <span className="bg-orange-200 px-1">gnarly logic</span>).
          </p>

          <p className="mb-4">
            Try it by changing any GitHub pull request url link to{" "}
            <span className="bg-yellow-300 px-1">0github.com</span>. Under the
            hood, we spin up{" "}
            <span className="bg-yellow-200 px-1">gpt-5-codex</span> for every
            diff and ask it to output a JSON data structure that we parse into a{" "}
            <span className="bg-yellow-200 px-1">colored heatmap</span>.
          </p>

          <p className="mb-4">
            Heatmap is open source under the{" "}
            <a
              href="https://github.com/manaflow-ai/cmux"
              target="_blank"
              rel="noopener noreferrer"
              className="text-black underline"
            >
              <span className="bg-sky-100 px-1">cmux</span> repo
            </a>
            .
          </p>
        </div>

        <div className="mt-8 text-base">
          <p className="mb-4">
            <span className="bg-yellow-200 px-1">Examples:</span>
          </p>
          <div className="flex flex-col gap-2">
            <a
              href="https://0github.com/tinygrad/tinygrad/pull/12999"
              target="_blank"
              rel="noopener noreferrer"
              className="text-black underline"
            >
              https://<span className="bg-yellow-300 px-1">0github.com</span>
              /tinygrad/tinygrad/pull/12999
            </a>
            <a
              href="https://0github.com/simonw/datasette/pull/2548"
              target="_blank"
              rel="noopener noreferrer"
              className="text-black underline"
            >
              https://<span className="bg-yellow-300 px-1">0github.com</span>
              /simonw/datasette/pull/2548
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
