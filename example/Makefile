PKG      := hello
VERSION  := 0.1.0
PREFIX   := /opt/$(PKG)-$(VERSION)
DESTDIR  :=

CC       ?= cc
CFLAGS   ?= -O2 -Wall -Wextra -std=c11

.PHONY: all install clean

all: hello

hello: hello.c
	$(CC) $(CFLAGS) -o $@ $<

install: hello
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 hello $(DESTDIR)$(PREFIX)/bin/hello

clean:
	rm -f hello