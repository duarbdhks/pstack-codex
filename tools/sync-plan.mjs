export function componentAction({ pinTree, headTree }) {
  if (!headTree) return "fail";
  if (pinTree === headTree) return "skip";
  return "sync";
}

export function pushAction({ openPr, remoteExists, authorNames }) {
  const human = (authorNames ?? []).some((name) => name !== "github-actions[bot]");
  if (openPr && human) return "report-only";
  if (openPr) return "force-with-lease";
  if (remoteExists && human) return "report-only";
  if (remoteExists) return "force-with-lease";
  return "push";
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "component") {
    process.stdout.write(componentAction({ pinTree: rest[0] ?? "", headTree: rest[1] ?? "" }));
  } else if (cmd === "push") {
    const text = rest.join("\n");
    const [openPr, remoteExists, ...authorNames] = text.split("\n");
    process.stdout.write(
      pushAction({
        openPr: openPr === "1",
        remoteExists: remoteExists === "1",
        authorNames: authorNames.filter((name) => name.length > 0),
      }),
    );
  } else {
    process.stderr.write("usage: sync-plan.mjs component|push\n");
    process.exit(2);
  }
}
