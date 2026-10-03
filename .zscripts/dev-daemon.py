#!/usr/bin/env python3
"""Conditera dev daemon: double-fork + env normalization for local runtime."""
import os, sys
ROOT = '/home/z/my-project'
LOG = os.path.join(ROOT, 'dev.log')

def read_env_local():
    env = {}
    p = os.path.join(ROOT, '.env.local')
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

pid = os.fork()
if pid == 0:
    os.setsid()
    if os.fork() == 0:
        os.close(0); os.close(1); os.close(2)
        fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        os.dup2(fd, 1); os.dup2(fd, 2)
        devnull = os.open('/dev/null', os.O_RDONLY); os.dup2(devnull, 0)
        os.chdir(ROOT)
        envl = read_env_local()
        # Локальный рантайм: env платформы не должен перекрывать .env.local
        if envl.get('DATABASE_URL'):
            os.environ['DATABASE_URL'] = envl['DATABASE_URL']
        os.environ.setdefault('NODE_ENV', 'development')
        os.execvp('bun', ['bun', 'run', 'dev'])
    os._exit(0)
os.waitpid(pid, 0)
print("dev daemon launched")
