# Backend image for a cloud demo deployment (see DEPLOY_VERCEL.md). Build context: this directory (backend/).
FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x gradlew && ./gradlew --no-daemon --version > /dev/null
COPY src src
# the tests need a real MySQL and run in CI/locally, not while building the image
RUN ./gradlew --no-daemon bootJar -x test \
 && cp "$(ls build/libs/*.jar | grep -v -- '-plain' | head -1)" /app.jar

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=build /app.jar /app/app.jar
USER app
# PORT is read by the application (default 8080); the platform usually sets it
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -Dfile.encoding=UTF-8 -Duser.timezone=UTC"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
