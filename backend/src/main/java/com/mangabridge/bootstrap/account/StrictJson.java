package com.mangabridge.bootstrap.account;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;

/** A request body is read exactly as written: unknown fields and a number, boolean or object where a string belongs are refused. */
final class StrictJson {
    private StrictJson() { }
    static ObjectMapper of(ObjectMapper base) {
        ObjectMapper mapper = base.copy().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        var text = mapper.coercionConfigFor(LogicalType.Textual);
        text.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
        text.setCoercion(CoercionInputShape.Float, CoercionAction.Fail);
        text.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail);
        return mapper;
    }
}
