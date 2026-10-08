package com.mangabridge.bootstrap.work;
import java.util.Map;
public final class WorkFailure extends RuntimeException {
 public final int status;public final String code;public final Map<String,Object> details;
 private WorkFailure(int status,String code,Map<String,Object> details){super(code);this.status=status;this.code=code;this.details=details;}
 static WorkFailure invalid(){return new WorkFailure(400,"INVALID_REQUEST",Map.of());}
 static WorkFailure missing(){return new WorkFailure(404,"NOT_FOUND",Map.of());}
 static WorkFailure unavailable(){return new WorkFailure(503,"SERVICE_UNAVAILABLE",Map.of());}
 static WorkFailure state(String reason){return new WorkFailure(409,"STATE_CONFLICT",Map.of("reason",reason));}
 static WorkFailure revision(int latest){return new WorkFailure(409,"REVISION_CONFLICT",Map.of("latestRevision",latest));}
}
