PKG      := cloud-apt-info
VERSION  := 0.1.0
PREFIX   := /opt/$(PKG)-$(VERSION)
DESTDIR  :=

# No compile step: build-deb.sh installs the script directly.
.PHONY: all install clean

all:
	@echo "$(PKG) $(VERSION): nothing to build (pure Python)"

install:
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 cloud-apt-info.py $(DESTDIR)$(PREFIX)/bin/cloud-apt-info.py

clean:
	@echo "$(PKG) $(VERSION): nothing to clean"