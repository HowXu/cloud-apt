#include <stdio.h>
#include <string.h>

#define HELLO_VERSION "0.2.0"
#define HELLO_REPO    "https://deb.howxu.cn"

static void usage(const char *prog) {
    fprintf(stderr,
        "Usage: %s [--version] [--repo] [--help]\n"
        "  (无参数)    打印 Hello, cloud-apt!\n"
        "  --version   输出版本号\n"
        "  --repo      输出上游 apt 仓库地址\n"
        "  --help      本帮助\n",
        prog);
}

int main(int argc, char **argv) {
    if (argc > 1) {
        if (!strcmp(argv[1], "--version")) {
            printf("hello %s\n", HELLO_VERSION);
            return 0;
        }
        if (!strcmp(argv[1], "--repo")) {
            printf("%s\n", HELLO_REPO);
            return 0;
        }
        if (!strcmp(argv[1], "--help")) {
            usage(argv[0]);
            return 0;
        }
        usage(argv[0]);
        return 2;
    }

    printf("Hello, cloud-apt! (v%s)\n", HELLO_VERSION);
    return 0;
}