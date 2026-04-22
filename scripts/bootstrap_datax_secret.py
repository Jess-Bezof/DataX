#!/usr/bin/env python3
"""One-time: register on DataX and store dx_ API key in Secret Manager (idempotent).

Runs in Cloud Build before deploy. If secret DATAX_API_KEY already exists, exits without
calling DataX again.

Environment:
  PROJECT_ID (required)
  DATAX_URL (optional, default production)
  AGENT_ROLE (optional, default buyer)
  AGENT_DISPLAY_NAME (optional)
  CRYPTO_WALLET (optional, for seller registration)
  PROJECT_NUMBER (optional; if unset, fetched via Cloud Resource Manager API)
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from google.api_core import exceptions as gexc
from google.auth.transport.requests import Request
from google.cloud import secretmanager
from google.iam.v1 import policy_pb2
import google.auth

SECRET_ID = "DATAX_API_KEY"
RUNTIME_SA_SUFFIX = "-compute@developer.gserviceaccount.com"
ACCESSOR_ROLE = "roles/secretmanager.secretAccessor"


def _runtime_member(project_number: str) -> str:
    return f"serviceAccount:{project_number}{RUNTIME_SA_SUFFIX}"


def _has_secret_accessor(
    client: secretmanager.SecretManagerServiceClient,
    secret_resource: str,
    member: str,
) -> bool:
    policy = client.get_iam_policy(request={"resource": secret_resource})
    for binding in policy.bindings:
        if binding.role == ACCESSOR_ROLE and member in binding.members:
            return True
    return False


def _print_manual_accessor_help(project_id: str, member: str) -> None:
    sys.stderr.write(
        "Could not set IAM on the secret (org policy may deny "
        "secretmanager.secrets.setIamPolicy for the Cloud Build service account).\n\n"
        "Grant the Cloud Run runtime service account read access once, then re-run the "
        "build. Example (single line; PowerShell or bash):\n\n"
        f"  gcloud secrets add-iam-policy-binding {SECRET_ID} "
        f'--project={project_id} --member="{member}" '
        f'--role="{ACCESSOR_ROLE}"\n\n'
    )


def _get_project_number(project_id: str) -> str:
    creds, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(Request())
    url = f"https://cloudresourcemanager.googleapis.com/v1/projects/{project_id}"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {creds.token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.stderr.write(
            f"Could not resolve project number (HTTP {e.code}). "
            "Pass _PROJECT_NUMBER in Cloud Build substitutions (setup.sh does this), "
            "or grant the Cloud Build SA permission to read project metadata.\n"
        )
        raise
    num = body.get("projectNumber")
    if not num:
        raise RuntimeError("projectNumber missing from Cloud Resource Manager response")
    return str(num)


def _register_datadx(base_url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/agents",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode(errors="replace")
        raise RuntimeError(
            f"DataX registration failed HTTP {e.code}: {err_body}"
        ) from e


def _grant_runtime_accessor(
    client: secretmanager.SecretManagerServiceClient,
    secret_resource: str,
    project_number: str,
) -> None:
    member = _runtime_member(project_number)
    policy = client.get_iam_policy(request={"resource": secret_resource})
    for binding in policy.bindings:
        if binding.role == ACCESSOR_ROLE:
            if member not in binding.members:
                binding.members.append(member)
            break
    else:
        policy.bindings.append(
            policy_pb2.Binding(role=ACCESSOR_ROLE, members=[member])
        )
    client.set_iam_policy(
        request={"resource": secret_resource, "policy": policy}
    )


def main() -> None:
    project_id = os.environ.get("PROJECT_ID")
    if not project_id:
        sys.stderr.write("PROJECT_ID is required\n")
        sys.exit(1)

    base_url = os.environ.get(
        "DATAX_URL", "https://data-xaidar.vercel.app"
    ).rstrip("/")
    role = os.environ.get("AGENT_ROLE", "buyer").strip().lower()
    display_name = os.environ.get(
        "AGENT_DISPLAY_NAME", "DataX ADK Agent"
    ).strip()
    crypto = os.environ.get("CRYPTO_WALLET", "").strip()

    client = secretmanager.SecretManagerServiceClient()
    parent = f"projects/{project_id}"
    secret_name = f"{parent}/secrets/{SECRET_ID}"

    try:
        client.get_secret(name=secret_name)
        print(f"Secret {SECRET_ID} already exists; skipping DataX registration.")
        return
    except gexc.NotFound:
        pass

    body: dict = {"role": role, "displayName": display_name}
    if crypto:
        body["cryptoWallet"] = crypto

    print("Registering new agent on DataX (apiKey will not be logged)...")
    reg = _register_datadx(base_url, body)
    api_key = reg.get("apiKey")
    if not api_key:
        sys.stderr.write(f"Registration response missing apiKey: {reg!r}\n")
        sys.exit(1)
    agent_id = reg.get("agentId", "")
    print(f"Registered agentId={agent_id}")

    secret = client.create_secret(
        request={
            "parent": parent,
            "secret_id": SECRET_ID,
            "secret": {"replication": {"automatic": {}}},
        }
    )
    client.add_secret_version(
        request={
            "parent": secret.name,
            "payload": {"data": api_key.encode("utf-8")},
        }
    )
    print(f"Created Secret Manager secret {SECRET_ID} (version added).")

    project_number = os.environ.get("PROJECT_NUMBER", "").strip()
    if not project_number:
        project_number = _get_project_number(project_id)
    member = _runtime_member(project_number)
    try:
        _grant_runtime_accessor(client, secret.name, project_number)
    except gexc.PermissionDenied:
        try:
            if _has_secret_accessor(client, secret.name, member):
                print(
                    f"{ACCESSOR_ROLE} already includes {member}; "
                    "continuing (setIamPolicy blocked by policy)."
                )
                return
        except gexc.PermissionDenied:
            pass
        _print_manual_accessor_help(project_id, member)
        sys.exit(1)
    print(
        f"Granted secretAccessor on {SECRET_ID} to "
        f"{project_number}{RUNTIME_SA_SUFFIX}."
    )


if __name__ == "__main__":
    main()
