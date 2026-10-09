package com.mangabridge.bootstrap.typesetting;
public class TypesettingFailure extends RuntimeException {
 public final int status;public final String code;private TypesettingFailure(int status,String code){super(code);this.status=status;this.code=code;}
 static TypesettingFailure notFound(){return new TypesettingFailure(404,"NOT_FOUND");}static TypesettingFailure forbidden(){return new TypesettingFailure(403,"FORBIDDEN");}static TypesettingFailure unavailable(){return new TypesettingFailure(503,"SERVICE_UNAVAILABLE");}
}
