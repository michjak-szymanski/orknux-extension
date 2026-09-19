# PDF

Composes PDF documents from a workflow: text, headings, tables — and a
Mermaid diagram drawn straight into the page, rendered by the same offline
pipeline the Mermaid plugin ships. The document comes back as base64 for a
downstream node to store or send.

Everything runs inside the sandbox; the PDF library ships as the plugin's own
bundled libraries, so nothing is installed on the server and nothing leaves
it.
