export function branchTasks(run, nextVersion, branch) {
  return [
    {
      title: `Creating release branch ${branch}`,
      task: async () => {
        run('git', ['checkout', '-b', branch]);
        return `Created ${branch}`;
      },
    },
    {
      title: `Bumping package version to ${nextVersion}`,
      task: async () => {
        run('npm', ['version', nextVersion, '--no-git-tag-version']);
        return `Version bumped to ${nextVersion}`;
      },
    },
    {
      title: 'Committing version bump',
      task: async () => {
        run('git', ['add', 'package.json', 'package-lock.json']);
        run('git', ['commit', '-m', `chore(release): v${nextVersion}`]);
        return `Committed chore(release): v${nextVersion}`;
      },
    },
  ];
}

export function mergeTasks(run, nextVersion, branch) {
  return [
    {
      title: 'Merging release branch into main',
      task: async () => {
        run('git', ['checkout', 'main']);
        run('git', ['merge', branch, '--no-edit']);
        return 'Merged into main';
      },
    },
    {
      title: `Creating git tag v${nextVersion}`,
      task: async () => {
        run('git', ['tag', `v${nextVersion}`]);
        return `Tagged v${nextVersion}`;
      },
    },
    {
      title: 'Merging main back into develop',
      task: async () => {
        run('git', ['checkout', 'develop']);
        run('git', ['merge', 'main', '--no-edit']);
        return 'Merged back into develop';
      },
    },
  ];
}

export function syncTasks(run, branch) {
  return [
    {
      title: 'Pushing main, develop, and tags to GitHub',
      task: async msg => {
        msg('Pushing main...');
        run('git', ['push', 'origin', 'main']);
        msg('Pushing develop...');
        run('git', ['push', 'origin', 'develop']);
        msg('Pushing tags...');
        run('git', ['push', 'origin', '--tags']);
        return 'Pushed to GitHub';
      },
    },
    {
      title: 'Cleaning up local release branch',
      task: async () => {
        try {
          run('git', ['branch', '-d', branch]);
        } catch {
          // Best-effort cleanup
        }
        return `Deleted ${branch}`;
      },
    },
  ];
}
