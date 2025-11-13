#!/usr/bin/env python3
# adduser.py
"""
User management utility for the Retail Development Map.

Usage examples:
  # Create an admin interactively
  python adduser.py create --username admin --admin

  # Create with explicit role
  python adduser.py create --username alice --role analyst

  # List users
  python adduser.py list

  # Change role
  python adduser.py update-role --user alice --role admin

  # Reset password
  python adduser.py reset-password --user alice

  # Delete user (with confirmation)
  python adduser.py delete --user alice
"""
import sys
import argparse
from getpass import getpass
from typing import Optional

from app import create_app, db
from app.models import User

VALID_ROLES = ("admin", "analyst", "viewer")


def prompt_password(confirm: bool = True) -> str:
    pw = getpass("Password: ")
    if not pw:
        print("❌ Password cannot be empty.")
        sys.exit(1)
    if confirm:
        pw2 = getpass("Confirm: ")
        if pw != pw2:
            print("❌ Passwords do not match.")
            sys.exit(1)
    return pw


def get_user(identifier: str) -> Optional[User]:
    """
    Accepts username or numeric id.
    """
    u = None
    if identifier.isdigit():
        u = User.query.get(int(identifier))
    if not u:
        u = User.query.filter_by(username=identifier).first()
    return u


def cmd_create(args):
    username = (args.username or "").strip()
    if not username:
        print("❌ --username is required.")
        sys.exit(1)

    if User.query.filter_by(username=username).first():
        print(f"❌ User '{username}' already exists.")
        sys.exit(1)

    # Role
    role = "admin" if args.admin else (args.role or "viewer")
    role = role.lower()
    if role not in VALID_ROLES:
        print(f"❌ Invalid role '{role}'. Choose from: {', '.join(VALID_ROLES)}")
        sys.exit(1)

    # Password (prompt if not provided via --password-stdin)
    if args.password_stdin:
        pw = sys.stdin.readline().rstrip("\n")
        if not pw:
            print("❌ Empty password from stdin.")
            sys.exit(1)
    else:
        pw = prompt_password(confirm=True)

    user = User(username=username, role=role)
    # set_password exists on your model
    user.set_password(pw)

    db.session.add(user)
    db.session.commit()
    print(f"✅ Created user '{username}' (id={user.id}, role={user.role}).")


def cmd_list(_args):
    users = User.query.order_by(User.id.asc()).all()
    if not users:
        print("(no users)")
        return

    print(f"{'ID':>4}  {'Username':<24}  {'Role':<8}  {'Created At'}")
    print("-" * 64)
    for u in users:
        created = (
            u.created_at.isoformat(sep=" ", timespec="seconds") if u.created_at else "-"
        )
        print(f"{u.id:>4}  {u.username:<24}  {u.role:<8}  {created}")


def cmd_update_role(args):
    who = (args.user or "").strip()
    if not who:
        print("❌ --user is required (username or id).")
        sys.exit(1)

    u = get_user(who)
    if not u:
        print(f"❌ User '{who}' not found.")
        sys.exit(1)

    role = (args.role or "").lower().strip()
    if role not in VALID_ROLES:
        print(f"❌ Invalid role '{role}'. Choose from: {', '.join(VALID_ROLES)}")
        sys.exit(1)

    u.role = role
    db.session.commit()
    print(f"✅ Updated '{u.username}' (id={u.id}) role → {u.role}.")


def cmd_reset_password(args):
    who = (args.user or "").strip()
    if not who:
        print("❌ --user is required (username or id).")
        sys.exit(1)

    u = get_user(who)
    if not u:
        print(f"❌ User '{who}' not found.")
        sys.exit(1)

    pw = prompt_password(confirm=True)
    u.set_password(pw)
    db.session.commit()
    print(f"✅ Password reset for '{u.username}' (id={u.id}).")


def cmd_delete(args):
    who = (args.user or "").strip()
    if not who:
        print("❌ --user is required (username or id).")
        sys.exit(1)

    u = get_user(who)
    if not u:
        print(f"❌ User '{who}' not found.")
        sys.exit(1)

    if not args.yes:
        ans = (
            input(f"⚠️  Delete user '{u.username}' (id={u.id})? Type 'yes' to confirm: ")
            .strip()
            .lower()
        )
        if ans != "yes":
            print("Cancelled.")
            return

    db.session.delete(u)
    db.session.commit()
    print(f"🗑️  Deleted user '{u.username}' (id={u.id}).")


def build_parser():
    p = argparse.ArgumentParser(
        description="Manage users for the Retail Development Map"
    )
    sub = p.add_subparsers(dest="command")

    # create
    p_create = sub.add_parser("create", help="Create a user")
    p_create.add_argument("--username", required=True, help="Username to create")
    p_create.add_argument("--role", choices=VALID_ROLES, help="Role (default: viewer)")
    p_create.add_argument(
        "--admin", action="store_true", help="Shortcut for --role admin"
    )
    p_create.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read password from stdin (first line). If omitted, prompts securely.",
    )
    p_create.set_defaults(func=cmd_create)

    # list
    p_list = sub.add_parser("list", help="List users")
    p_list.set_defaults(func=cmd_list)

    # update-role
    p_role = sub.add_parser("update-role", help="Change a user's role")
    p_role.add_argument("--user", required=True, help="Username or numeric id")
    p_role.add_argument("--role", required=True, choices=VALID_ROLES, help="New role")
    p_role.set_defaults(func=cmd_update_role)

    # reset-password
    p_pw = sub.add_parser("reset-password", help="Reset a user's password")
    p_pw.add_argument("--user", required=True, help="Username or numeric id")
    p_pw.set_defaults(func=cmd_reset_password)

    # delete
    p_del = sub.add_parser("delete", help="Delete a user")
    p_del.add_argument("--user", required=True, help="Username or numeric id")
    p_del.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    p_del.set_defaults(func=cmd_delete)

    return p


def main():
    app = create_app()
    with app.app_context():
        parser = build_parser()
        args = parser.parse_args()

        if not args.command:
            parser.print_help()
            sys.exit(1)

        args.func(args)


if __name__ == "__main__":
    main()
