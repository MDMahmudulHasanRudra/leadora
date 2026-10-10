// Preloaded into the API under PERF_PROFILE: exit cleanly on an IPC "exit" message so --cpu-prof writes its profile
// (killing a process on Windows does not run exit handlers).
process.on('message', (m) => {
  if (m === 'exit') process.exit(0);
});
