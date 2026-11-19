"""Renders docs/architecture/lazarus-aws.png from the CDK app in infra/lib.

Uses the `diagrams` library (MIT), which bundles the AWS Architecture Icons, and Graphviz.
    python docs/architecture/diagram.py              # docs PNG (padded to 16:9)
    python docs/architecture/diagram.py --card PATH  # also a 1920x1080 video card at PATH

PNG only: Graphviz SVG output links the icons by local file path instead of embedding them.
Draws only what infra/lib/*.ts deploys. No WAF and no VPC, by design (see site-stack.ts and
proof-api-stack.ts). Labels stay generic: no account ids, domains or emails.
"""

import argparse
import os
import diagrams
import tempfile
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECR, Lambda, LambdaFunction
from diagrams.aws.cost import Budgets
from diagrams.custom import Custom
from diagrams.aws.management import CloudwatchLogs
from diagrams.aws.network import CloudFront, Route53HostedZone
from diagrams.aws.security import CertificateManager
from diagrams.aws.storage import SimpleStorageServiceS3Bucket
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "lazarus-aws.png"

# The lab's palette (web/src): zinc-950 background, zinc text, green accent.
BG = "#09090b"
TEXT = "#e4e4e7"
MUTED = "#a1a1aa"
ACCENT = "#4ade80"
CLUSTER_BG = "#18181b"
STACK_BG = "#202024"
LINE = "#71717a"


def light_icon(name: str, tmp: Path) -> str:
    """The AWS "general" person icons are dark grey; tint them light so they read on BG."""
    src = Path(diagrams.__file__).parent.parent / "resources" / "aws" / "general" / f"{name}.png"
    img = Image.open(src).convert("RGBA")
    tint = Image.new("RGBA", img.size, TEXT)
    tint.putalpha(img.getchannel("A"))
    dest = tmp / f"{name}-light.png"
    tint.save(dest)
    return str(dest)


def cluster_attr(bg: str, border: str) -> dict[str, str]:
    return {
        "bgcolor": bg,
        "pencolor": border,
        "fontcolor": TEXT,
        "fontsize": "26",
        "fontname": "Helvetica-Bold",
        "style": "rounded",
        "margin": "24",
    }


def edge(label: str, color: str = LINE, style: str = "solid", **extra: str) -> Edge:
    return Edge(label=label, color=color, fontcolor=TEXT, style=style, fontsize="20", fontname="Helvetica", penwidth="2.5", **extra)


def render(stem: Path) -> Path:
    graph_attr = {
        "bgcolor": BG,
        "fontcolor": TEXT,
        "fontname": "Helvetica-Bold",
        "fontsize": "34",
        "pad": "0.6",
        "nodesep": "1.1",
        "ranksep": "0.8",
        "splines": "spline",
        "dpi": "110",
        "labelloc": "t",
    }
    node_attr = {"fontcolor": TEXT, "fontsize": "18", "fontname": "Helvetica", "imagepos": "tc"}
    with Diagram(
        "Lazarus on AWS",
        filename=str(stem),
        outformat="png",
        show=False,
        direction="LR",
        graph_attr=graph_attr,
        node_attr=node_attr,
    ):
        browser = Custom("User's browser", light_icon("users", stem.parent))
        owner = Custom("email (owner)", light_icon("user", stem.parent))

        with Cluster("AWS account (us-east-1)", graph_attr=cluster_attr(CLUSTER_BG, LINE)):
            ecr = ECR("ECR\n(CDK assets repo)")

            with Cluster("Lazarus-Site stack", graph_attr=cluster_attr(STACK_BG, ACCENT)):
                zone = Route53HostedZone("Route 53 alias\n(optional)")
                cert = CertificateManager("ACM certificate\n(optional)")
                cdn = CloudFront("CloudFront\nCSP headers policy\nSPA rewrite function")
                bucket = SimpleStorageServiceS3Bucket("S3 bucket\n(private, web build)")

            with Cluster("Lazarus-ProofApi stack", graph_attr=cluster_attr(STACK_BG, ACCENT)):
                url = LambdaFunction("Function URL\nAWS_IAM, RESPONSE_STREAM")
                fn = Lambda("Lambda container\narm64, 1024 MB, 30 s\nconcurrency 1\nGnuCOBOL 3.1.2 programs")
                budget = Budgets("AWS Budgets\nUSD 10 / month")
                logs = CloudwatchLogs("CloudWatch Logs\n(90 days)")

        browser >> edge("HTTPS", ACCENT, headport="w") >> cdn
        browser >> edge("DNS (custom domain, optional)", MUTED, "dashed") >> zone
        zone >> edge("alias", MUTED, "dashed") >> cdn
        cert >> edge("TLS", MUTED, "dashed") >> cdn
        cdn >> edge("/*  OAC SigV4") >> bucket
        cdn >> edge("/api/*  OAC SigV4", ACCENT, minlen="2") >> url  # keeps the stacks side by side
        url >> edge("invoke  /  NDJSON stream", ACCENT, dir="both") >> fn
        ecr >> edge("image", MUTED, "dashed", headport="n") >> fn
        fn >> edge("logs") >> logs
        fn >> Edge(style="invis") >> budget  # layout only: budget under the logs
        budget >> edge("cost alert", "#f87171") >> owner
    return stem.with_suffix(".png")


def pad(src: Path, dest: Path, size: tuple[int, int] | None = None) -> None:
    """Centres the render on the background colour: 16:9, or exactly `size` (scaled down to fit)."""
    img = Image.open(src).convert("RGB")
    if size is None:
        w, h = img.size
        if w / h > 16 / 9:
            size = (w, round(w * 9 / 16))
        else:
            size = (round(h * 16 / 9), h)
    else:
        scale = min(size[0] * 0.94 / img.width, size[1] * 0.94 / img.height, 1.0)
        if scale < 1.0:
            img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGB", size, BG)
    canvas.paste(img, ((size[0] - img.width) // 2, (size[1] - img.height) // 2))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--card", type=Path, help="also write a 1920x1080 card here")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.getcwd()
        os.chdir(tmp)  # diagrams writes the intermediate .dot here
        try:
            raw = render(Path(tmp) / "raw")
            pad(raw, OUT)
            if args.card is not None:
                pad(raw, args.card.resolve() if args.card.is_absolute() else Path(cwd) / args.card, (1920, 1080))
        finally:
            os.chdir(cwd)
    print(f"wrote {OUT}" + (f" and {args.card}" if args.card else ""))


if __name__ == "__main__":
    main()
