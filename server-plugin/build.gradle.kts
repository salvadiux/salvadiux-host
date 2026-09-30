plugins {
    java
}

group = "net.salvadiux"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.1-R0.1-SNAPSHOT")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(21))
}

tasks.jar {
    archiveFileName.set("SalvadiuxNetworkCore-${project.version}.jar")
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
    options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:unchecked"))
}
