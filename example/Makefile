PKG      := cloud-apt-hello
VERSION  := 0.2.0
PREFIX   := /opt/$(PKG)-$(VERSION)
DESTDIR  :=

CC       ?= cc
CFLAGS   ?= -O2 -Wall -Wextra -std=c11

.PHONY: all install clean

all: cloud-apt-hello

cloud-apt-hello: cloud-apt-hello.c
	$(CC) $(CFLAGS) -o $@ $<

install: cloud-apt-hello
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 cloud-apt-hello $(DESTDIR)$(PREFIX)/bin/cloud-apt-hello

clean:
	rm -f cloud-apt-hello